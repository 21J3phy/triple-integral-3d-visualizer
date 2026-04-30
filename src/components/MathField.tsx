import React, { useRef, useEffect, useState } from 'react';
import { autoReplaceMathSymbols } from '../lib/mathSymbols';

interface MathFieldProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  inputRef?: (element: HTMLInputElement | null) => void;
  className?: string;
  placeholder?: string;
}

export const MathField: React.FC<MathFieldProps> = ({
  value,
  onChange,
  onFocus,
  inputRef: registerInput,
  className = '',
  placeholder = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursorPos, setCursorPos] = useState(0);

  // We use a real input for typing but hide it
  // and render a pretty version on top.
  // This gives us accessibility and standard cursor behavior for free.

  useEffect(() => {
    registerInput?.(inputRef.current);
    return () => registerInput?.(null);
  }, [registerInput]);
  
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
    
    // Match the parser's shorthand rule: √ covers the next contiguous operand,
    // or a full parenthesized expression.
    
    while (i < value.length) {
      if (value[i] === '√') {
        parts.push(<span key={i} className="sqrt-symbol">√</span>);
        i++;
        const start = i;
        i = readRadicandEnd(value, i);
        parts.push(<span key={start} className="sqrt-content">{value.slice(start, i)}</span>);
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

function readRadicandEnd(value: string, start: number): number {
  if (start >= value.length) return start;

  let i = start;
  let depth = 0;

  if (value[i] === '(') {
    depth = 1;
    i++;
    while (i < value.length && depth > 0) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
      i++;
    }
    return i;
  }

  while (i < value.length) {
    const character = value[i];
    if (character === '(') depth++;
    else if (character === ')') {
      if (depth === 0) break;
      depth--;
    }

    if (depth === 0 && /[\s+\-*\/=,;]/u.test(character)) break;
    i++;
  }

  return i;
}
