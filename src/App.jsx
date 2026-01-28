import { useState, useEffect, useRef } from 'react';

// ■ 設定：EdrawMind風カラーパレット
const BRANCH_COLORS = [
  '#4D94FF', '#00C853', '#FFAA00', '#AA00FF', '#FF4081', '#00B8D4'
];

function App() {
  // ■ 設定：レイアウトの「余白」設定（固定幅ではなく、文字幅+この余白になります）
  const GAP_CONFIG = {
    rootMarginX: 120,    // 親 → 子 の横の余白（広め）
    childMarginX: 60,    // 子 → 孫 の横の余白（狭め）
    
    rootMarginY: 80,     // 大きな枝同士の縦の隙間
    childMarginY: 40     // 細かい項目の縦の隙間
  };

  // --- 1. データ管理 ---
  const loadFromStorage = () => {
    const saved = localStorage.getItem("my-mindmap-data");
    return saved ? JSON.parse(saved) : [{ id: 1, text: "店舗", parentId: null }];
  };

  const [nodes, setNodes] = useState(loadFromStorage);
  
  // 履歴・クリップボード
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [clipboard, setClipboard] = useState(null);

  const [layoutNodes, setLayoutNodes] = useState([]);

  // 状態管理
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  
  // ドラッグ＆ドロップ
  const [draggingId, setDraggingId] = useState(null);
  const [dragPosition, setDragPosition] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [dropType, setDropType] = useState(null);

  // ズーム
  const [scale, setScale] = useState(1.0);

  const containerRef = useRef(null);
  const textareaRef = useRef(null);

  // 保存
  useEffect(() => {
    localStorage.setItem("my-mindmap-data", JSON.stringify(nodes));
  }, [nodes]);

  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
      textareaRef.current.style.width = 'auto';
      textareaRef.current.style.width = textareaRef.current.scrollWidth + 'px';
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editingId]);

  // --- 2. 履歴機能 ---
  const pushToHistory = () => {
    setHistory(prev => [...prev, nodes]);
    setFuture([]);
  };

  const undo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    setFuture(prev => [nodes, ...prev]);
    setNodes(previous);
    setHistory(newHistory);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    setHistory(prev => [...prev, nodes]);
    setNodes(next);
    setFuture(newFuture);
  };

  // --- 3. コピー＆ペースト ---
  const copyNode = () => {
    if (!selectedId) return;
    const targetNode = nodes.find(n => n.id === selectedId);
    if (!targetNode || targetNode.parentId === null) return;
    const getDescendants = (nodeId) => {
      const children = nodes.filter(n => n.parentId === nodeId);
      let list = [];
      children.forEach(child => {
        list.push(child);
        list.push(...getDescendants(child.id));
      });
      return list;
    };
    const descendants = getDescendants(selectedId);
    setClipboard({ root: targetNode, descendants: descendants });
  };

  const pasteNode = () => {
    if (!clipboard || !selectedId) return;
    pushToHistory();
    const idMap = {};
    const baseTime = Date.now();
    let counter = 0;
    const generateId = () => baseTime + (counter++);
    idMap[clipboard.root.id] = generateId();
    clipboard.descendants.forEach(node => { idMap[node.id] = generateId(); });
    const newRoot = {
      ...clipboard.root,
      id: idMap[clipboard.root.id],
      parentId: selectedId,
    };
    const newDescendants = clipboard.descendants.map(node => ({
      ...node,
      id: idMap[node.id],
      parentId: idMap[node.parentId]
    }));
    setNodes(prev => [...prev, newRoot, ...newDescendants]);
    setTimeout(() => { setSelectedId(newRoot.id); }, 50);
  };

  // --- 4. ズーム ---
  const handleZoom = (newScale) => {
    const clamped = Math.min(Math.max(newScale, 0.1), 3.0);
    setScale(clamped);
  };

  // --- 5. ★文字幅計算（重要） ---
  const getTextWidth = (text, isRoot) => {
     if (!text) return 50;
     const fontSize = isRoot ? 16 : 14;
     let length = 0;
     for (let i = 0; i < text.length; i++) {
        // 全角は2、半角は1として計算（概算）
        length += (text.charCodeAt(i) > 255) ? 2 : 1;
     }
     // フォントサイズ等を考慮したピクセル幅 + パディング(30px)
     return Math.max(length * (fontSize * 0.6) + 30, 50);
  };

  // --- 6. ★レイアウト計算（ここを大幅修正） ---
  useEffect(() => {
    const newLayout = [];
    let layoutState = { currentY: 50 };

    // 再帰的に配置を計算
    // parentX: 親のX座標, parentWidth: 親の幅
    const calculateLayout = (nodeId, depth, assignedColor, parentX, parentWidth) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return 0;
      
      const children = nodes.filter(n => n.parentId === nodeId);
      
      let myY = 0;
      let myColor = assignedColor;

      // 色決め
      if (depth === 1) {
        const rootId = node.parentId;
        const siblings = nodes.filter(n => n.parentId === rootId);
        const index = siblings.findIndex(n => n.id === nodeId);
        myColor = BRANCH_COLORS[index % BRANCH_COLORS.length];
      }
      if (depth === 0) myColor = '#333';

      // ★ 自分の幅を計算
      const isRoot = depth === 0;
      const myWidth = getTextWidth(node.text, isRoot);

      // ★ X座標の計算：親の右端(parentX + parentWidth) から 余白(Margin) を空ける
      // 固定幅ではなく、前のノードの幅に依存して位置が決まる
      const margin = depth === 0 ? 0 : (depth === 1 ? GAP_CONFIG.rootMarginX : GAP_CONFIG.childMarginX);
      const myX = depth === 0 ? 50 : (parentX + parentWidth + margin);

      if (children.length === 0) {
        // 子がいない（末端）
        myY = layoutState.currentY;
        layoutState.currentY += GAP_CONFIG.childMarginY;
      } else {
        // 子がいる場合、子の計算結果(Y座標)の中央に配置
        // ここで自分のXとWidthを親情報として子に渡す
        const childrenYs = children.map(child => calculateLayout(child.id, depth + 1, myColor, myX, myWidth));
        myY = (childrenYs[0] + childrenYs[childrenYs.length - 1]) / 2;
      }

      // 第1階層の区切りを広げる
      if (depth === 1) {
          layoutState.currentY += GAP_CONFIG.rootMarginY;
      }

      // 幅情報(width)も保存しておく（線の描画で使うため）
      newLayout.push({ ...node, x: myX, y: myY, color: myColor, depth, width: myWidth });
      return myY;
    };

    const rootNodes = nodes.filter(n => n.parentId === null);
    // ルートの初期位置X=50, 幅=0(便宜上)でスタート
    rootNodes.forEach(root => calculateLayout(root.id, 0, '#333', 50, 0));
    setLayoutNodes(newLayout);
  }, [nodes]);

  // --- 7. アクション ---
  const addNode = (parentId) => {
    pushToHistory();
    const newNode = { id: Date.now(), text: "新規トピック", parentId };
    setNodes(prev => [...prev, newNode]);
    setTimeout(() => { setSelectedId(newNode.id); setEditingId(newNode.id); }, 50);
  };

  const deleteNode = (id) => {
    const target = nodes.find(n => n.id === id);
    if (!target || target.parentId === null) return;
    pushToHistory();
    const getDescendants = (nodeId) => {
      const children = nodes.filter(n => n.parentId === nodeId);
      let ids = [nodeId];
      children.forEach(child => ids.push(...getDescendants(child.id)));
      return ids;
    };
    const idsToDelete = getDescendants(id);
    setNodes(prev => prev.filter(n => !idsToDelete.includes(n.id)));
    setSelectedId(null);
  };

  const updateText = (id, text) => {
    const node = nodes.find(n => n.id === id);
    if (node && node.text === text) return;
    pushToHistory();
    setNodes(prev => prev.map(n => n.id === id ? { ...n, text } : n));
  };

  // --- 8. イベントハンドラ ---
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      const isInputActive = document.activeElement.tagName === 'TEXTAREA';
      if (isInputActive) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (isCtrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }
      if (isCtrl && e.key === 'c') { e.preventDefault(); copyNode(); return; }
      if (isCtrl && e.key === 'v') { e.preventDefault(); pasteNode(); return; }
      if (isCtrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); handleZoom(scale + 0.1); return; }
      if (isCtrl && e.key === '-') { e.preventDefault(); handleZoom(scale - 0.1); return; }

      if (selectedId) {
        if (e.key === 'Tab') { e.preventDefault(); addNode(selectedId); }
        if (e.key === 'Delete' || e.key === 'Backspace') { deleteNode(selectedId); }
        if (e.key === 'Enter') { e.preventDefault(); setEditingId(selectedId); }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selectedId, nodes, history, future, clipboard, scale]);

  const handleMouseDown = (e, id) => {
    e.stopPropagation();
    if (editingId === id) return;
    setSelectedId(id);
    const node = nodes.find(n => n.id === id);
    if (node && node.parentId === null) return;
    setDraggingId(id);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!draggingId) return;
      setDragPosition({ x: e.clientX, y: e.clientY });

      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      const targetElement = elements.find(el => el.dataset.nodeid && el.dataset.nodeid != draggingId);
      
      if (targetElement) {
        const targetId = Number(targetElement.dataset.nodeid);
        const rect = targetElement.getBoundingClientRect();
        const targetNode = nodes.find(n => n.id === targetId);

        if (targetNode && targetNode.parentId === null) {
             setDropTargetId(targetId);
             setDropType('parent');
        } else {
             const yRel = e.clientY - rect.top;
             const height = rect.height;
             if (yRel < height * 0.25) {
                setDropTargetId(targetId);
                setDropType('before');
             } else if (yRel > height * 0.75) {
                setDropTargetId(targetId);
                setDropType('after');
             } else {
                setDropTargetId(targetId);
                setDropType('parent');
             }
        }
      } else {
        setDropTargetId(null);
        setDropType(null);
      }
    };

    const handleMouseUp = () => {
      if (!draggingId) return;

      if (dropTargetId && dropType) {
        pushToHistory();
        const movingNode = nodes.find(n => n.id === draggingId);
        const targetNode = nodes.find(n => n.id === dropTargetId);

        if (movingNode && targetNode) {
            let newNodes = [...nodes];
            newNodes = newNodes.filter(n => n.id !== draggingId);
            
            if (dropType === 'parent') {
                newNodes.push({ ...movingNode, parentId: targetNode.id });
            } else {
                const targetIndex = newNodes.findIndex(n => n.id === dropTargetId);
                const insertIndex = dropType === 'before' ? targetIndex : targetIndex + 1;
                const updatedNode = { ...movingNode, parentId: targetNode.parentId };
                newNodes.splice(insertIndex, 0, updatedNode);
            }
            setNodes(newNodes);
        }
      }
      setDraggingId(null); setDragPosition(null); setDropTargetId(null); setDropType(null);
    };

    if (draggingId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingId, dropTargetId, dropType, nodes]);


  const zoomBtnStyle = {
    width: "24px", height: "24px", cursor: "pointer", border: "none", 
    backgroundColor: "transparent", fontSize: "16px", color: "#555",
    display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px"
  };

  return (
    <div 
      ref={containerRef}
      style={{ width: "100vw", height: "100vh", backgroundColor: "#fff", overflow: "auto", position: "relative", userSelect: "none" }}
      onClick={() => { setSelectedId(null); setEditingId(null); }}
    >
      <div style={{ width: `${3000 * scale}px`, height: `${3000 * scale}px`, position: "relative" }}>
        <div style={{ 
          width: "3000px", height: "3000px", 
          transform: `scale(${scale})`, transformOrigin: "0 0",
          position: "absolute", top: 0, left: 0
        }}>
          
          <svg style={{ position: "absolute", width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}>
            {layoutNodes.map(node => {
              if (!node.parentId) return null;
              const parent = layoutNodes.find(n => n.id === node.parentId);
              if (!parent) return null;
              
              const isParentRoot = parent.depth === 0;
              
              // ★ 線の始点を、親の文字幅の最後尾にする
              const startX = parent.x + parent.width; 
              const startY = parent.y + 20; 
              const endX = node.x;
              const endY = node.y + 28;

              // 制御点も余白に合わせて調整
              const dist = endX - startX;
              const controlPointOffset = dist * 0.5;

              return (
                <path 
                  key={`line-${node.id}`} 
                  d={`M ${startX} ${startY} C ${startX + controlPointOffset} ${startY}, ${endX - controlPointOffset} ${endY}, ${endX} ${endY}`} 
                  stroke={node.color} strokeWidth="2" fill="none" 
                />
              );
            })}
          </svg>

          {/* ドラッグ中のオレンジバー */}
          {(dropType === 'before' || dropType === 'after') && dropTargetId && (() => {
               const target = layoutNodes.find(n => n.id === dropTargetId);
               if (!target) return null;
               const barY = dropType === 'before' ? target.y - 10 : target.y + 50; 
               return (
                   <div style={{
                       position: 'absolute', left: target.x, top: barY, width: target.width, height: '4px',
                       backgroundColor: '#FFAA00', borderRadius: '2px', zIndex: 100, boxShadow: '0 0 4px rgba(255, 170, 0, 0.6)'
                   }}>
                       <div style={{
                           position: 'absolute', left: -4, top: -3, width: '10px', height: '10px',
                           borderRadius: '50%', backgroundColor: '#FFAA00'
                       }} />
                   </div>
               );
          })()}

          {layoutNodes.map((node) => {
            const isRoot = node.parentId === null;
            const isSelected = selectedId === node.id;
            const isEditing = editingId === node.id;
            const isDropTarget = dropTargetId === node.id;
            const showDropBorder = isDropTarget && dropType === 'parent';

            return (
              <div
                key={node.id}
                data-nodeid={node.id}
                onMouseDown={(e) => handleMouseDown(e, node.id)}
                onDoubleClick={(e) => { e.stopPropagation(); setEditingId(node.id); }}
                style={{
                  position: "absolute", 
                  left: node.x, top: node.y, 
                  // 幅は自動計算されているが、DOM上でもなりゆき任せにする
                  width: "auto", minWidth: "50px",
                  backgroundColor: isRoot ? "#222" : "transparent", 
                  border: showDropBorder ? "2px solid #FFAA00" : (isSelected ? "2px solid #007bff" : "2px solid transparent"),
                  borderRadius: isRoot ? "6px" : "4px",
                  padding: "5px 10px",
                  color: isRoot ? "#fff" : "#000",
                  zIndex: 10,
                  cursor: isEditing ? "text" : "grab",
                  opacity: draggingId === node.id ? 0.3 : 1,
                  whiteSpace: "pre" 
                }}
              >
                {isEditing ? (
                  <textarea
                    ref={textareaRef}
                    defaultValue={node.text}
                    onBlur={(e) => { updateText(node.id, e.target.value); setEditingId(null); }}
                    onInput={(e) => {
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                        e.target.style.width = 'auto';
                        e.target.style.width = e.target.scrollWidth + 'px';
                    }}
                    onKeyDown={(e) => { 
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } 
                    }}
                    style={{ 
                      width: "auto", height: "auto", minWidth: "100px",
                      background: isRoot ? "#222" : "#fff", color: isRoot ? "#fff" : "#000", 
                      border: "none", outline: "none", resize: "none", overflow: "hidden",
                      fontFamily: "inherit", fontSize: isRoot ? "16px" : "14px", whiteSpace: "pre"
                    }}
                  />
                ) : (
                  <div style={{ minHeight: "24px", fontWeight: isRoot ? "bold" : "normal", fontSize: isRoot ? "16px" : "14px", textAlign: isRoot ? "center" : "left", whiteSpace: "pre" }}>
                    {node.text || "トピック"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {draggingId && dragPosition && (
          <div style={{
              position: 'fixed', left: dragPosition.x + 10, top: dragPosition.y + 10,
              padding: '8px', background: 'rgba(0,0,0,0.8)', color: 'white',
              borderRadius: '4px', pointerEvents: 'none', zIndex: 9999
          }}>
              移動中...
          </div>
      )}

      <div style={{
        position: "fixed", bottom: 20, right: 20,
        backgroundColor: "white", padding: "5px 15px",
        borderRadius: "20px", boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
        display: "flex", alignItems: "center", gap: "10px", zIndex: 1000
      }}>
        <button onClick={() => handleZoom(scale - 0.1)} style={zoomBtnStyle}>－</button>
        <input 
          type="range" min="10" max="300" value={Math.round(scale * 100)} 
          onChange={(e) => handleZoom(e.target.value / 100)}
          style={{ width: "100px", cursor: "pointer" }}
        />
        <button onClick={() => handleZoom(scale + 0.1)} style={zoomBtnStyle}>＋</button>
        <span style={{ minWidth: "40px", textAlign: "right", fontSize: "14px", color: "#555", fontWeight: "bold" }}>
          {Math.round(scale * 100)}%
        </span>
      </div>

      <div style={{ position: "fixed", bottom: 10, left: 10, background: "rgba(255,255,255,0.8)", padding: "10px", fontSize: "12px", borderRadius: "4px", border: "1px solid #ddd" }}>
        <b>操作ガイド:</b><br/>
        ・ドラッグ: <br/>
        　- 上端/下端へ → 並び替え (オレンジ線)<br/>
        　- 中央へ → 子として追加
      </div>
    </div>
  );
}

export default App;