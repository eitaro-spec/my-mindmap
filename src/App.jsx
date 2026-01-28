import { useState, useEffect, useRef, useMemo } from 'react';

// ■ 設定：EdrawMind風カラーパレット
const BRANCH_COLORS = [
  '#4D94FF', '#00C853', '#FFAA00', '#AA00FF', '#FF4081', '#00B8D4'
];

// ■ 設定：フォント
const MAIN_FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function App() {
  // ■ 設定：レイアウトの余白
  const GAP_CONFIG = {
    rootMarginX: 120,    
    childMarginX: 80,    
    rootMarginY: 80,     
    childMarginY: 40     
  };

  // --- 1. データ管理 ---
  const loadFromStorage = () => {
    try {
      const saved = localStorage.getItem("my-mindmap-data");
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map(n => ({ ...n, comment: n.comment || "" }));
      }
      return [{ id: 1, text: "店舗", parentId: null, comment: "" }];
    } catch (e) {
      return [{ id: 1, text: "店舗", parentId: null, comment: "" }];
    }
  };

  const [nodes, setNodes] = useState(loadFromStorage);
  const [layoutNodes, setLayoutNodes] = useState([]);
  
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [clipboard, setClipboard] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  
  // ★コメント用状態管理
  const [contextMenu, setContextMenu] = useState(null); 
  const [editingCommentId, setEditingCommentId] = useState(null);

  const [draggingId, setDraggingId] = useState(null); 
  const [dragPosition, setDragPosition] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [dropType, setDropType] = useState(null);

  const [isMouseDown, setIsMouseDown] = useState(false);
  const [mouseDownPos, setMouseDownPos] = useState(null);
  const [dragTargetId, setDragTargetId] = useState(null);

  const [scale, setScale] = useState(1.0);

  const containerRef = useRef(null);
  const textareaRef = useRef(null);
  const commentInputRef = useRef(null);
  const measureCanvas = useMemo(() => document.createElement('canvas'), []);

  // 保存
  useEffect(() => {
    localStorage.setItem("my-mindmap-data", JSON.stringify(nodes));
  }, [nodes]);

  // トピック編集モード時のフォーカス＆全選択
  useEffect(() => {
    if (editingId && textareaRef.current) {
      resizeTextarea(textareaRef.current);
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editingId]);

  // ★コメント編集モード時のフォーカス＆全選択（ここが重要）
  useEffect(() => {
    if (editingCommentId && commentInputRef.current) {
      // 少し遅延させると確実にフォーカスが当たる場合がありますが、
      // 基本的にはこれですぐに全選択状態になります。
      commentInputRef.current.focus();
      commentInputRef.current.select();
    }
  }, [editingCommentId]);

  const resizeTextarea = (el) => {
    if(!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    el.style.width = 'auto';
    el.style.width = el.scrollWidth + 'px';
  };

  // --- 履歴機能 ---
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

  // --- コピー＆ペースト ---
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
      comment: clipboard.root.comment || ""
    };
    const newDescendants = clipboard.descendants.map(node => ({
      ...node,
      id: idMap[node.id],
      parentId: idMap[node.parentId],
      comment: node.comment || ""
    }));
    setNodes(prev => [...prev, newRoot, ...newDescendants]);
    setTimeout(() => { setSelectedId(newRoot.id); }, 50);
  };

  const handleZoom = (newScale) => {
    const clamped = Math.min(Math.max(newScale, 0.1), 3.0);
    setScale(clamped);
  };

  // --- 文字幅計算 ---
  const getTextWidth = (text, isRoot) => {
     const t = text || "トピック"; 
     const context = measureCanvas.getContext('2d');
     const fontSize = isRoot ? "bold 16px" : "14px";
     context.font = `${fontSize} ${MAIN_FONT}`;
     
     const lines = t.split('\n');
     let maxWidth = 0;
     lines.forEach(line => {
        const metrics = context.measureText(line);
        if (metrics.width > maxWidth) maxWidth = metrics.width;
     });
     return Math.ceil(maxWidth + 40);
  };

  // --- レイアウト計算 ---
  useEffect(() => {
    const newLayout = [];
    let layoutState = { currentY: 50 };

    const calculateLayout = (nodeId, depth, assignedColor, parentX, parentWidth) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return 0;
      
      const children = nodes.filter(n => n.parentId === nodeId);
      
      let myY = 0;
      let myColor = assignedColor;

      if (depth === 1) {
        const rootId = node.parentId;
        const siblings = nodes.filter(n => n.parentId === rootId);
        const index = siblings.findIndex(n => n.id === nodeId);
        myColor = BRANCH_COLORS[index % BRANCH_COLORS.length];
      }
      if (depth === 0) myColor = '#333';

      const isRoot = depth === 0;
      const myWidth = getTextWidth(node.text, isRoot);

      const margin = depth === 0 ? 0 : (depth === 1 ? GAP_CONFIG.rootMarginX : GAP_CONFIG.childMarginX);
      const myX = depth === 0 ? 50 : (parentX + parentWidth + margin);

      if (children.length === 0) {
        myY = layoutState.currentY;
        layoutState.currentY += GAP_CONFIG.childMarginY;
      } else {
        const childrenYs = children.map(child => calculateLayout(child.id, depth + 1, myColor, myX, myWidth));
        myY = (childrenYs[0] + childrenYs[childrenYs.length - 1]) / 2;
      }

      if (depth === 1) {
          layoutState.currentY += GAP_CONFIG.rootMarginY;
      }

      newLayout.push({ ...node, x: myX, y: myY, color: myColor, depth, width: myWidth });
      return myY;
    };

    const rootNodes = nodes.filter(n => n.parentId === null);
    rootNodes.forEach(root => calculateLayout(root.id, 0, '#333', 50, 0));
    setLayoutNodes(newLayout);
  }, [nodes]);

  // --- アクション ---
  const addNode = (parentId) => {
    pushToHistory();
    const newNode = { id: Date.now(), text: "新規トピック", parentId, comment: "" };
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

  const updateComment = (id, comment) => {
    pushToHistory();
    setNodes(prev => prev.map(n => n.id === id ? { ...n, comment } : n));
    setEditingCommentId(null);
  };

  // --- イベントハンドラ ---
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // コメント編集中はショートカット無効
      if (editingCommentId) return;

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
  }, [selectedId, nodes, history, future, clipboard, scale, editingCommentId]);

  // 右クリックメニュー表示
  const handleContextMenu = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeId: id
    });
  };

  const handleMouseDown = (e, id) => {
    e.stopPropagation();
    // 他の操作をしたらメニュー等は閉じる
    setContextMenu(null);
    if (editingCommentId) setEditingCommentId(null);

    // 既に編集中なら確定
    if (editingId && editingId !== id) {
       setEditingId(null);
    }
    if (editingId === id) return;

    setSelectedId(id);

    const node = nodes.find(n => n.id === id);
    if (node && node.parentId === null) return;

    setIsMouseDown(true);
    setMouseDownPos({ x: e.clientX, y: e.clientY });
    setDragTargetId(id);
  };

  useEffect(() => {
    const handleWindowMouseMove = (e) => {
      if (isMouseDown && dragTargetId && !draggingId) {
         const dx = e.clientX - mouseDownPos.x;
         const dy = e.clientY - mouseDownPos.y;
         if (dx * dx + dy * dy > 25) { 
            setDraggingId(dragTargetId);
         }
      }

      if (draggingId) {
        setDragPosition({ x: e.clientX, y: e.clientY });
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        const targetElement = elements.find(el => el.dataset.nodeid && el.dataset.nodeid != draggingId);
        
        if (targetElement) {
          const targetId = Number(targetElement.dataset.nodeid);
          const rect = targetElement.getBoundingClientRect();
          const targetNode = nodes.find(n => n.id === targetId);

          if (targetNode && targetNode.parentId === null) {
              setDropTargetId(targetId); setDropType('parent');
          } else {
              const yRel = e.clientY - rect.top;
              const height = rect.height;
              if (yRel < height * 0.25) { setDropTargetId(targetId); setDropType('before'); }
              else if (yRel > height * 0.75) { setDropTargetId(targetId); setDropType('after'); }
              else { setDropTargetId(targetId); setDropType('parent'); }
          }
        } else {
          setDropTargetId(null); setDropType(null);
        }
      }
    };

    const handleWindowMouseUp = () => {
      if (draggingId) {
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
                  newNodes.splice(insertIndex, 0, { ...movingNode, parentId: targetNode.parentId });
              }
              setNodes(newNodes);
          }
        }
      }

      setIsMouseDown(false);
      setDraggingId(null);
      setDragTargetId(null);
      setDragPosition(null);
      setDropTargetId(null);
      setDropType(null);
      setMouseDownPos(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isMouseDown, dragTargetId, mouseDownPos, draggingId, dropTargetId, dropType, nodes]);

  const zoomBtnStyle = {
    width: "24px", height: "24px", cursor: "pointer", border: "none", 
    backgroundColor: "transparent", fontSize: "16px", color: "#555",
    display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "4px"
  };

  return (
    <div 
      ref={containerRef}
      style={{ 
          width: "100vw", height: "100vh", backgroundColor: "#fff", 
          overflow: "auto", position: "relative", userSelect: "none",
          fontFamily: MAIN_FONT
      }}
      onClick={() => { 
          setSelectedId(null); 
          setEditingId(null); 
          setContextMenu(null); 
          setEditingCommentId(null);
      }}
    >
      <div style={{ width: `${4000 * scale}px`, height: `${4000 * scale}px`, position: "relative" }}>
        <div style={{ 
          width: "4000px", height: "4000px", 
          transform: `scale(${scale})`, transformOrigin: "0 0",
          position: "absolute", top: 0, left: 0
        }}>
          
          <svg style={{ position: "absolute", width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}>
            {layoutNodes.map(node => {
              if (!node.parentId) return null;
              const parent = layoutNodes.find(n => n.id === node.parentId);
              if (!parent) return null;
              const parentW = parent.width || 100;

              const startX = parent.x + parentW; 
              const startY = parent.y + 20; 
              const endX = node.x;
              const endY = node.y + 28;
              const dist = endX - startX;
              const controlPointOffset = Math.max(dist * 0.5, 30);

              return (
                <path 
                  key={`line-${node.id}`} 
                  d={`M ${startX} ${startY} C ${startX + controlPointOffset} ${startY}, ${endX - controlPointOffset} ${endY}, ${endX} ${endY}`} 
                  stroke={node.color} strokeWidth="2" fill="none" 
                />
              );
            })}
          </svg>

          {(dropType === 'before' || dropType === 'after') && dropTargetId && (() => {
               const target = layoutNodes.find(n => n.id === dropTargetId);
               if (!target) return null;
               const barY = dropType === 'before' ? target.y - 10 : target.y + 50; 
               return (
                   <div style={{
                       position: 'absolute', left: target.x, top: barY, width: target.width || 100, height: '4px',
                       backgroundColor: '#FFAA00', borderRadius: '2px', zIndex: 100, boxShadow: '0 0 4px rgba(255, 170, 0, 0.6)'
                   }}>
                       <div style={{ position: 'absolute', left: -4, top: -3, width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#FFAA00' }} />
                   </div>
               );
          })()}

          {layoutNodes.map((node) => {
            const isRoot = node.parentId === null;
            const isSelected = selectedId === node.id;
            const isEditing = editingId === node.id;
            const isDropTarget = dropTargetId === node.id;
            const showDropBorder = isDropTarget && dropType === 'parent';
            const hasComment = node.comment && node.comment.trim() !== "";
            const isCommentEditing = editingCommentId === node.id;

            return (
              <div
                key={node.id}
                data-nodeid={node.id}
                onMouseDown={(e) => handleMouseDown(e, node.id)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => { e.stopPropagation(); setEditingId(node.id); }}
                onContextMenu={(e) => handleContextMenu(e, node.id)}
                style={{
                  position: "absolute", 
                  left: node.x, top: node.y, 
                  width: "auto", minWidth: "50px",
                  backgroundColor: isRoot ? "#222" : "transparent", 
                  border: showDropBorder ? "2px solid #FFAA00" : (isSelected ? "2px solid #007bff" : "2px solid transparent"),
                  borderRadius: isRoot ? "6px" : "4px",
                  padding: "5px 10px",
                  color: isRoot ? "#fff" : "#000",
                  zIndex: isSelected || isCommentEditing ? 50 : 10,
                  cursor: isEditing ? "text" : "grab",
                  opacity: draggingId === node.id ? 0.3 : 1,
                  whiteSpace: "pre" 
                }}
              >
                {/* コメントインジケーター */}
                {hasComment && !isCommentEditing && (
                    <div style={{
                        position: 'absolute', top: 0, right: 0,
                        width: 0, height: 0,
                        borderLeft: '8px solid transparent',
                        borderRight: '8px solid #FFAB00',
                        borderBottom: '8px solid transparent',
                        borderTop: '8px solid #FFAB00',
                        pointerEvents: 'none'
                    }} />
                )}

                {/* コメント閲覧ポップアップ (選択時のみ) */}
                {isSelected && hasComment && !isCommentEditing && !draggingId && (
                    <div style={{
                        position: 'absolute',
                        top: '-10px', left: '100%', transform: 'translate(10px, 0)',
                        backgroundColor: '#fff', border: '1px solid #ccc', padding: '8px 12px',
                        borderRadius: '4px', boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                        zIndex: 100, width: 'max-content', maxWidth: '250px',
                        fontSize: '13px', color: '#333', whiteSpace: 'pre-wrap', pointerEvents: 'none'
                    }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#666', fontSize: '11px' }}>コメント</div>
                        {node.comment}
                    </div>
                )}

                {/* ★コメント編集ボックス */}
                {isCommentEditing && (
                    <div 
                        onMouseDown={(e) => e.stopPropagation()} 
                        style={{
                            position: 'absolute', top: '100%', left: 0,
                            marginTop: '5px', zIndex: 110,
                            backgroundColor: '#fff', boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                            padding: '10px', borderRadius: '4px', border: '1px solid #ddd', width: '200px'
                        }}
                    >
                        <textarea 
                            ref={commentInputRef}
                            defaultValue={node.comment}
                            placeholder="コメントを入力..."
                            // クリックでカーソル移動できるようバブリング停止
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{ 
                                width: '100%', height: '80px', resize: 'none', 
                                border: '1px solid #eee', outline: 'none', 
                                padding: '5px', fontSize: '13px', fontFamily: 'inherit'
                            }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '5px', gap: '5px' }}>
                             <button 
                                onClick={() => setEditingCommentId(null)}
                                style={{ fontSize: '12px', padding: '3px 8px', cursor: 'pointer' }}>
                                キャンセル
                             </button>
                             <button 
                                onClick={() => updateComment(node.id, commentInputRef.current.value)}
                                style={{ fontSize: '12px', padding: '3px 8px', cursor: 'pointer', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '3px' }}>
                                保存
                             </button>
                        </div>
                    </div>
                )}

                {isEditing ? (
                  <textarea
                    ref={textareaRef}
                    defaultValue={node.text}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { updateText(node.id, e.target.value); setEditingId(null); }}
                    onInput={(e) => resizeTextarea(e.target)}
                    onKeyDown={(e) => { 
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } 
                    }}
                    style={{ 
                      width: "auto", height: "auto", minWidth: "100px",
                      background: isRoot ? "#222" : "#fff", color: isRoot ? "#fff" : "#000", 
                      border: "none", outline: "none", resize: "none", overflow: "hidden",
                      fontFamily: MAIN_FONT, fontSize: isRoot ? "16px" : "14px", whiteSpace: "pre"
                    }}
                  />
                ) : (
                  <div style={{ 
                      minHeight: "24px", fontWeight: isRoot ? "bold" : "normal", 
                      fontSize: isRoot ? "16px" : "14px", textAlign: isRoot ? "center" : "left", 
                      whiteSpace: "pre", fontFamily: MAIN_FONT 
                  }}>
                    {node.text || "トピック"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {draggingId && dragPosition && (
          <div style={{ position: 'fixed', left: dragPosition.x + 10, top: dragPosition.y + 10, padding: '8px', background: 'rgba(0,0,0,0.8)', color: 'white', borderRadius: '4px', pointerEvents: 'none', zIndex: 9999 }}>移動中...</div>
      )}

      {/* ★右クリックメニュー */}
      {contextMenu && (
          <div 
             style={{
                 position: 'fixed', top: contextMenu.y, left: contextMenu.x,
                 backgroundColor: '#fff', border: '1px solid #ddd',
                 boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                 zIndex: 9999, borderRadius: '4px', padding: '5px 0'
             }}
             onMouseDown={(e) => e.stopPropagation()}
          >
              <div 
                // ★左クリックで編集開始
                onClick={(e) => {
                    e.stopPropagation();
                    setEditingCommentId(contextMenu.nodeId);
                    setContextMenu(null);
                }}
                style={{ padding: '8px 15px', cursor: 'pointer', fontSize: '14px', color: '#333' }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
              >
                  💬 コメントを編集
              </div>
          </div>
      )}

      <div style={{
        position: "fixed", bottom: 20, right: 20,
        backgroundColor: "white", padding: "5px 15px",
        borderRadius: "20px", boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
        display: "flex", alignItems: "center", gap: "10px", zIndex: 1000
      }}>
        <button onClick={() => handleZoom(scale - 0.1)} style={zoomBtnStyle}>－</button>
        <input type="range" min="10" max="300" value={Math.round(scale * 100)} onChange={(e) => handleZoom(e.target.value / 100)} style={{ width: "100px", cursor: "pointer" }} />
        <button onClick={() => handleZoom(scale + 0.1)} style={zoomBtnStyle}>＋</button>
        <span style={{ minWidth: "40px", textAlign: "right", fontSize: "14px", color: "#555", fontWeight: "bold" }}>{Math.round(scale * 100)}%</span>
      </div>

      <div style={{ position: "fixed", bottom: 10, left: 10, background: "rgba(255,255,255,0.8)", padding: "10px", fontSize: "12px", borderRadius: "4px", border: "1px solid #ddd" }}>
        <b>操作ガイド:</b><br/>
        ・ワンクリック: 選択<br/>
        ・右クリック: コメント追加・編集<br/>
        ・ドラッグ: 移動<br/>
        ・Ctrl+Z: 戻る
      </div>
    </div>
  );
}

export default App;