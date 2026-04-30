import React, { useRef, useEffect, useState } from 'react';
import { autoReplaceMathSymbols } from '../lib/mathSymbols';

interface MathFieldProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  className?: string;
  placeholder?: string;
}

export const MathField: React.FC<MathFieldProps> = ({
  value,
  onChange,
  onFocus,
  className = '',
  placeholder = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursorPos, setCursorPos] = useState(0);

  // We use a real input for typing but hide it
  // and render a pretty version on top.
  // This gives us accessibility and standard cursor behavior for free.
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const replaced = autoReplaceMathSymbols(e.target.value);
    onChange(replaced);
    setCursorPos(e.target.selectionStart || 0);
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCursorPos(e.currentTarget.selectionStart || 0);
  };

  const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
    setCursorPos(e.currentTarget.selectionStart || 0);
  };

  // Render the value with "√" blocks
  const renderPretty = () => {
    if (!value && placeholder) return <span className="math-placeholder">{placeholder}</span>;

    const parts: React.ReactNode[] = [];
    let i = 0;
    
    // We'll parse the string for √ sequences
    // A sequence starts with √ and continues until we hit an operator or space,
    // OR if there are parentheses, until the closing one.
    // However, the user said "i shouldn't need parentheses".
    // So we'll assume a √ block ends at the next space or operator.
    
    while (i < value.length) {
      if (value[i] === '√') {
        parts.push(<span key={i} className="sqrt-symbol">√</span>);
        i++;
        let start = i;
        // Search for end of block: next space, operator (+, -, *, /) or end of string
        // If there's an open paren right after √, we go to the matching close paren.
        if (value[i] === '(') {
            let depth = 1;
            i++;
            while (i < value.length && depth > 0) {
                if (value[i] === '(') depth++;
                if (value[i] === ')') depth--;
                i++;
            }
            parts.push(<span key={start} className="sqrt-content">{value.slice(start, i)}</span>);
        } else {
            while (i < value.length && !/[ +\-*\/^]/.test(value[i])) {
                i++;
            }
            parts.push(<span key={start} className="sqrt-content">{value.slice(start, i)}</span>);
        }
      } else {
        parts.push(value[i]);
        i++;
      }
    }
    
    return parts;
  };

  return (
    <div className={`math-field-container ${className}`}>
      <div className="math-field-visual" aria-hidden="true">
        {renderPretty()}
        <span 
            className="math-cursor" 
            style={{ 
                left: `${cursorPos * 9}px`, // Extremely rough estimate, will need better measurement
                opacity: inputRef.current === document.activeElement ? 1 : 0 
            }} 
        />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyUp={handleKeyUp}
        onClick={handleClick}
        onFocus={onFocus}
        className="math-field-input"
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
};
