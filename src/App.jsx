import { useState, useEffect, useRef } from 'react';

// ■ コンポーネント：日本語入力（IME）の文字化けを完全に防ぐテキストエリア
const AutoResizeTextarea = ({ defaultValue, onSave, onKeyDown, style }) => {
  const textareaRef = useRef(null);
  const isComposing = useRef(false);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.value = defaultValue;
      resize();
    }
  }, [defaultValue]);

  const resize = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleInput = (e) => {
    resize();
    if (!isComposing.current) {
      onSave(e.target.value);
    }
  };

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd = (e) => {
    isComposing.current = false;
    onSave(e.target.value);
  };

  return (
    <textarea
      ref={textareaRef}
      defaultValue={defaultValue}
      onInput={handleInput}
      onKeyDown={(e) => onKeyDown(e, isComposing.current)}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      rows={1}
      style={{
        ...style,
        resize: 'none',
        overflow: 'hidden',
        fontFamily: 'inherit',
        lineHeight: '1.5',
        display: 'block'
      }}
    />
  );
};

function App() {
  const X_GAP = 350;
  const Y_GAP = 90;

  const loadFromStorage = () => {
    const saved = localStorage.getItem("my-mindmap-data");
    return saved ? JSON.parse(saved) : [{ id: 1, text: "テーマを入力\n(Tabで子を追加)", parentId: null }];
  };

  const [nodes, setNodes] = useState(loadFromStorage);
  const [layoutNodes, setLayoutNodes] = useState([]);
  const [draggingId, setDraggingId] = useState(null);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState(null);
  const containerRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("my-mindmap-data", JSON.stringify(nodes));
  }, [nodes]);

  useEffect(() => {
    const newLayout = [];
    let currentLeafY = 50; 

    const calculatePosition = (nodeId, depth) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return 0;
      const children = nodes.filter(n => n.parentId === nodeId);
      let myY = 0;
      if (children.length === 0) {
        myY = currentLeafY;
        currentLeafY += Y_GAP;
      } else {
        const childrenYs = children.map(child => calculatePosition(child.id, depth + 1));
        myY = (childrenYs[0] + childrenYs[childrenYs.length - 1]) / 2;
      }
      newLayout.push({ ...node, x: 50 + depth * X_GAP, y: myY });
      return myY;
    };

    const rootNodes = nodes.filter(n => n.parentId === null);
    rootNodes.forEach(root => calculatePosition(root.id, 0));
    setLayoutNodes(newLayout);
  }, [nodes]);

  const addNode = (parentId) => {
    const newNode = { id: Date.now(), text: "", parentId };
    setNodes(prev => [...prev, newNode]);
  };

  const deleteNode = (id) => {
    if (nodes.find(n => n.id === id).parentId === null) return;
    const getDescendants = (nodeId) => {
      const children = nodes.filter(n => n.parentId === nodeId);
      let ids = [nodeId];
      children.forEach(child => ids.push(...getDescendants(child.id)));
      return ids;
    };
    const idsToDelete = getDescendants(id);
    setNodes(prev => prev.filter(n => !idsToDelete.includes(n.id)));
  };

  const updateText = (id, text) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, text } : n));
  };

  const moveNode = (id, direction) => {
    const node = nodes.find(n => n.id === id);
    if (!node || node.parentId === null) return;
    const siblings = nodes.filter(n => n.parentId === node.parentId);
    const index = siblings.findIndex(n => n.id === id);

    if (direction === 'up' && index > 0) {
      const newNodes = [...nodes];
      const targetId = siblings[index - 1].id;
      const idxA = newNodes.findIndex(n => n.id === id);
      const idxB = newNodes.findIndex(n => n.id === targetId);
      [newNodes[idxA], newNodes[idxB]] = [newNodes[idxB], newNodes[idxA]];
      setNodes(newNodes);
    } else if (direction === 'down' && index < siblings.length - 1) {
      const newNodes = [...nodes];
      const targetId = siblings[index + 1].id;
      const idxA = newNodes.findIndex(n => n.id === id);
      const idxB = newNodes.findIndex(n => n.id === targetId);
      [newNodes[idxA], newNodes[idxB]] = [newNodes[idxB], newNodes[idxA]];
      setNodes(newNodes);
    }
  };

  const handleKeyDown = (e, composing, id) => {
    if (composing) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      addNode(id);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace') {
      e.preventDefault();
      deleteNode(id);
    }
  };

  const getMapCoordinates = (clientX, clientY) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: clientX - rect.left + containerRef.current.scrollLeft,
      y: clientY - rect.top + containerRef.current.scrollTop
    };
  };

  const handleMouseDown = (e) => {
    if (e.target === containerRef.current || e.target.tagName === 'svg') {
      const { x, y } = getMapCoordinates(e.clientX, e.clientY);
      setIsSelecting(true);
      setSelectionBox({ startX: x, startY: y, currentX: x, currentY: y });
    }
  };

  const handleMouseMove = (e) => {
    if (isSelecting) {
      const { x, y } = getMapCoordinates(e.clientX, e.clientY);
      setSelectionBox(prev => ({ ...prev, currentX: x, currentY: y }));
    }
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
    setSelectionBox(null);
  };

  const getSelectionBoxStyle = () => {
    if (!selectionBox) return {};
    const { startX, startY, currentX, currentY } = selectionBox;
    return {
      position: 'absolute',
      left: Math.min(startX, currentX), top: Math.min(startY, currentY),
      width: Math.abs(currentX - startX), height: Math.abs(currentY - startY),
      border: '1px dashed #007bff', backgroundColor: 'rgba(0, 123, 255, 0.1)',
      pointerEvents: 'none', zIndex: 100
    };
  };

  // ボタンの共通スタイル
  const btnStyle = {
    fontSize: "11px",
    cursor: "pointer",
    border: "1px solid #bbb",
    borderRadius: "4px",
    padding: "2px 6px",
    backgroundColor: "#fff",
    color: "#000", // ★ここを黒色に
    fontWeight: "bold",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 1px 2px rgba(0,0,0,0.1)"
  };

  return (
    <div 
      ref={containerRef}
      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
      style={{ width: "100vw", height: "100vh", backgroundColor: "#f5f5f5", overflow: "auto", position: "relative", userSelect: "none" }}
    >
      <div style={{ width: "3000px", height: "3000px", position: "relative" }}>
        <svg style={{ position: "absolute", width: "100%", height: "100%", pointerEvents: "none", zIndex: 5 }}>
          {layoutNodes.map(node => {
            if (!node.parentId) return null;
            const parent = layoutNodes.find(n => n.id === node.parentId);
            if (!parent) return null;
            const startX = parent.x + 180;
            const startY = parent.y + 45; 
            const endX = node.x;
            const endY = node.y + 45;
            return <path key={`line-${node.id}`} d={`M ${startX} ${startY} C ${startX + X_GAP/2} ${startY}, ${endX - X_GAP/2} ${endY}, ${endX} ${endY}`} stroke="#646cff" strokeWidth="3" fill="none" />;
          })}
        </svg>

        {layoutNodes.map((node) => (
          <div
            key={node.id}
            onMouseDown={(e) => e.stopPropagation()} 
            style={{
              position: "absolute", left: node.x, top: node.y, width: "180px",
              backgroundColor: node.parentId === null ? "#333" : "white", color: node.parentId === null ? "white" : "black",
              padding: "15px", borderRadius: "8px", border: node.parentId === null ? "none" : "2px solid #ddd",
              boxShadow: "0 4px 6px rgba(0,0,0,0.1)", zIndex: 10, display: 'flex', flexDirection: 'column'
            }}
          >
            <AutoResizeTextarea 
              defaultValue={node.text}
              onSave={(text) => updateText(node.id, text)}
              onKeyDown={(e, composing) => handleKeyDown(e, composing, node.id)}
              style={{ width: "100%", background: "transparent", border: "none", color: "inherit", fontWeight: "bold", outline: "none", marginBottom: "10px", padding: 0, cursor: "text" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
              <button onClick={() => addNode(node.id)} onMouseDown={(e) => e.stopPropagation()} style={{ fontSize: "11px", cursor: "pointer", backgroundColor: "#e0e0e0", border: "none", borderRadius: "4px", padding: "4px 8px" }}>＋子</button>
              
              {node.parentId !== null && (
                <div style={{ display: "flex", gap: "3px" }}>
                  <button onClick={() => moveNode(node.id, 'up')} onMouseDown={(e) => e.stopPropagation()} style={btnStyle}>↑</button>
                  <button onClick={() => moveNode(node.id, 'down')} onMouseDown={(e) => e.stopPropagation()} style={btnStyle}>↓</button>
                </div>
              )}

              {node.parentId !== null && (
                <button onClick={() => deleteNode(node.id)} onMouseDown={(e) => e.stopPropagation()} style={{ fontSize: "11px", cursor: "pointer", backgroundColor: "#ffdddd", color: "red", border: "none", borderRadius: "4px", padding: "4px 8px" }}>削除</button>
              )}
            </div>
          </div>
        ))}
        {isSelecting && selectionBox && <div style={getSelectionBoxStyle()} />}
      </div>
    </div>
  );
}

export default App;