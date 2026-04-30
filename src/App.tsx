import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { AlertTriangle, ArrowRightLeft, Bookmark, Calculator, Check, ChevronDown, ChevronUp, Eye, EyeOff, FilePlus2, Github, GripVertical, Keyboard, Link, Linkedin, MoveHorizontal, Share2, X } from 'lucide-react';
import { ThreeRegionView } from './components/ThreeRegionView';
import { rewriteBoundsForOrder, rewriteVariables } from './lib/bounds';
import { areValidVariables, convertIntegralToCoordinateSystem, COORDINATE_LABELS, DEFAULT_VARIABLES, defaultOuterToInner } from './lib/coordinates';
import { parseIntegral, sampleRegion, solveIntegralExactly } from './lib/integral';
import { orderFromOuterToInner, orderToOuterInner } from './lib/orders';
import { PRESETS } from './lib/presets';
import { PresetPreview } from './components/PresetPreview';
import { buildShareUrl, copyToClipboard, getSharedEquation, withJacobianDefault } from './lib/sharing';
import { MathField } from './components/MathField';
import { autoReplaceMathSymbols } from './lib/mathSymbols';
import type { CoordinateSystem, IntegralInput, Variable } from './types';

const SHARED_INPUT = getSharedEquation();
const STARTER = withJacobianDefault(SHARED_INPUT ?? PRESETS[1].input);
const SAMPLE_COUNT = 8000;
const SWAP_ANIMATION_MS = 260;
const MIN_SLICE_COUNT = 1;
const MAX_SLICE_COUNT = 100;
const SLICE_COUNT_WARNING_THRESHOLD = 20;
const BUY_ME_COFFEE_URL = 'https://buymeacoffee.com/21J3phy';
const COORDINATE_SYSTEMS = Object.keys(COORDINATE_LABELS) as CoordinateSystem[];
type ElementRects = Partial<Record<Variable, DOMRect>>;
type BoundSide = 'lower' | 'upper';
type ExpressionTarget = { kind: 'integrand' } | { kind: 'bound'; variable: Variable; side: BoundSide };

const SYMBOL_KEYBOARD_GROUPS: Array<{
  label: string;
  keys: Array<{ label: string; insert: string; caretOffset?: number; title: string }>;
}> = [
  {
    label: 'Symbols',
    keys: [
      { label: 'ρ', insert: 'rho', title: 'rho' },
      { label: 'θ', insert: 'theta', title: 'theta' },
      { label: 'φ', insert: 'phi', title: 'phi' },
      { label: 'π', insert: 'pi', title: 'pi' },
      { label: 'e', insert: 'e', title: 'Euler constant' },
    ],
  },
  {
    label: 'Functions',
    keys: [
      { label: '√', insert: 'sqrt()', caretOffset: 5, title: 'sqrt()' },
      { label: 'sin', insert: 'sin()', caretOffset: 4, title: 'sin()' },
      { label: 'cos', insert: 'cos()', caretOffset: 4, title: 'cos()' },
      { label: 'tan', insert: 'tan()', caretOffset: 4, title: 'tan()' },
      { label: 'log', insert: 'log()', caretOffset: 4, title: 'log()' },
      { label: 'abs', insert: 'abs()', caretOffset: 4, title: 'abs()' },
    ],
  },
  {
    label: 'Operators',
    keys: [
      { label: 'x²', insert: '^2', title: 'square' },
      { label: '^', insert: '^', title: 'power' },
      { label: '+', insert: ' + ', title: 'plus' },
      { label: '−', insert: ' - ', title: 'minus' },
      { label: '×', insert: ' * ', title: 'multiply' },
      { label: '÷', insert: ' / ', title: 'divide' },
      { label: '(', insert: '(', title: 'left parenthesis' },
      { label: ')', insert: ')', title: 'right parenthesis' },
    ],
  },
];

export function App() {
  const [input, setInput] = useState<IntegralInput>(STARTER);
  const [variableDrafts, setVariableDrafts] = useState<[string, string, string]>(STARTER.variables);
  const [draggedVariable, setDraggedVariable] = useState<Variable | null>(null);
  const [dropVariable, setDropVariable] = useState<Variable | null>(null);
  const [pendingCoordinateSystem, setPendingCoordinateSystem] = useState<CoordinateSystem | null>(null);
  const [{ sliceCount, selectedSlice }, setSliceSettings] = useState({ sliceCount: 7, selectedSlice: 7 });
  const [isResultVisible, setIsResultVisible] = useState(true);
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const [isShared] = useState(!!SHARED_INPUT);
  const integralRefs = useRef<Partial<Record<Variable, HTMLDivElement>>>({});
  const differentialRefs = useRef<Partial<Record<Variable, HTMLButtonElement>>>({});
  const expressionInputRefs = useRef<Record<string, HTMLInputElement>>({});
  const activeExpressionTarget = useRef<ExpressionTarget>({ kind: 'integrand' });
  const pendingSelection = useRef<{ key: string; position: number } | null>(null);
  const previousIntegralRects = useRef<ElementRects | null>(null);
  const previousDifferentialRects = useRef<ElementRects | null>(null);

  const parsed = useMemo(() => parseIntegral(input), [input]);
  const sample = useMemo(() => sampleRegion(parsed, SAMPLE_COUNT), [parsed]);
  const exact = useMemo(() => solveIntegralExactly(parsed), [parsed]);
  const variables = input.variables;
  const outerToInner = orderToOuterInner(input.selectedOrder);
  const innerToOuter = [...outerToInner].reverse();
  const selectedCoordinateIndex = COORDINATE_SYSTEMS.indexOf(input.coordinateSystem);


  useEffect(() => {
    setVariableDrafts(input.variables);
  }, [input.variables]);

  const updateBound = (variable: Variable, side: 'lower' | 'upper', value: string) => {
    const nextValue = autoReplaceMathSymbols(value);
    setInput((current) => ({
      ...current,
      bounds: {
        ...current.bounds,
        [variable]: { ...current.bounds[variable], [side]: nextValue },
      },
    }));
  };
  const updateSliceCount = (value: string) => {
    const nextCount = clampInteger(Number(value), MIN_SLICE_COUNT, MAX_SLICE_COUNT);
    setSliceSettings((current) => {
      const currentPercent = current.selectedSlice / current.sliceCount;
      const selectedSlice = clampInteger(Math.round(currentPercent * nextCount), MIN_SLICE_COUNT, nextCount);
      return { sliceCount: nextCount, selectedSlice };
    });
  };
  const updateSelectedSlice = (value: string) => {
    setSliceSettings((current) => ({
      ...current,
      selectedSlice: clampInteger(Number(value), MIN_SLICE_COUNT, current.sliceCount),
    }));
  };
  const updateCoordinateSystem = (coordinateSystem: CoordinateSystem) => {
    if (coordinateSystem === input.coordinateSystem) {
      setPendingCoordinateSystem(null);
      return;
    }
    setPendingCoordinateSystem(coordinateSystem);
  };
  const convertToPendingCoordinateSystem = () => {
    if (!pendingCoordinateSystem) return;
    setInput((current) => convertIntegralToCoordinateSystem(current, pendingCoordinateSystem));
    setPendingCoordinateSystem(null);
  };
  const startFreshInPendingCoordinateSystem = () => {
    if (!pendingCoordinateSystem) return;
    setInput(defaultInputForCoordinateSystem(pendingCoordinateSystem));
    setPendingCoordinateSystem(null);
  };
  const updateVariableDraft = (index: number, value: string) => {
    const nextValue = autoReplaceMathSymbols(value);
    const nextDrafts = variableDrafts.map((name, itemIndex) => (itemIndex === index ? nextValue : name)) as [string, string, string];
    setVariableDrafts(nextDrafts);
    if (areValidVariables(nextDrafts)) {
      setInput((current) => rewriteVariables(current, nextDrafts));
    }
  };
  const commitVariableDrafts = () => {
    const nextVariables = variableDrafts.map((name) => name.trim()) as [string, string, string];
    if (!areValidVariables(nextVariables)) {
      setVariableDrafts(input.variables);
      return;
    }
    setInput((current) => rewriteVariables(current, nextVariables));
  };
  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };
  const registerExpressionInput = (target: ExpressionTarget, element: HTMLInputElement | null) => {
    const key = expressionTargetKey(target);
    if (element) expressionInputRefs.current[key] = element;
    else delete expressionInputRefs.current[key];
  };
  const selectExpressionTarget = (target: ExpressionTarget) => {
    activeExpressionTarget.current = target;
  };

  const insertExpressionSnippet = (snippet: string, caretOffset = snippet.length) => {
    const target = usableExpressionTarget(activeExpressionTarget.current, input);
    const key = expressionTargetKey(target);
    const element = expressionInputRefs.current[key];
    const currentValue = expressionValue(target, input);
    const start = element?.selectionStart ?? currentValue.length;
    const end = element?.selectionEnd ?? start;
    const nextValue = `${currentValue.slice(0, start)}${snippet}${currentValue.slice(end)}`;
    pendingSelection.current = { key, position: start + caretOffset };
    activeExpressionTarget.current = target;

    const replacedValue = autoReplaceMathSymbols(nextValue);
    setInput((current) => {
      if (target.kind === 'integrand') return { ...current, integrand: replacedValue };
      return {
        ...current,
        bounds: {
          ...current.bounds,
          [target.variable]: {
            ...current.bounds[target.variable],
            [target.side]: replacedValue,
          },
        },
      };
    });
  };

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    if (!selection) return;
    pendingSelection.current = null;
    const element = expressionInputRefs.current[selection.key] ?? expressionInputRefs.current.integrand;
    if (!element) return;
    element.focus();
    element.setSelectionRange(selection.position, selection.position);
  }, [input]);

  const handleShare = useCallback(async () => {
    const url = buildShareUrl(withJacobianDefault(input));
    const success = await copyToClipboard(url);
    if (success) {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2400);
    }
  }, [input]);

  const captureSwapRects = () => {
    previousIntegralRects.current = measureElements(integralRefs.current, variables);
    previousDifferentialRects.current = measureElements(differentialRefs.current, variables);
  };

  const registerIntegralBlock = (variable: Variable, element: HTMLDivElement | null) => {
    if (element) integralRefs.current[variable] = element;
    else delete integralRefs.current[variable];
  };

  const registerDifferential = (variable: Variable, element: HTMLButtonElement | null) => {
    if (element) differentialRefs.current[variable] = element;
    else delete differentialRefs.current[variable];
  };

  useLayoutEffect(() => {
    animateSwappedElements(previousIntegralRects.current, integralRefs.current, variables);
    animateSwappedElements(previousDifferentialRects.current, differentialRefs.current, variables);
    previousIntegralRects.current = null;
    previousDifferentialRects.current = null;
  }, [outerToInner.join('|'), variables]);

  const dragTargetAt = (clientX: number, clientY: number): Variable | null => {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-differential-variable]');
    const variable = element?.dataset.differentialVariable;
    return variable && variables.includes(variable) ? variable : null;
  };

  const moveDifferential = (from: Variable, to: Variable) => {
    if (from === to) return;
    captureSwapRects();
    setInput((current) => {
      const nextInnerToOuter = [...orderToOuterInner(current.selectedOrder)].reverse();
      const fromIndex = nextInnerToOuter.indexOf(from);
      const toIndex = nextInnerToOuter.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return current;
      nextInnerToOuter.splice(fromIndex, 1);
      nextInnerToOuter.splice(toIndex, 0, from);
      return rewriteBoundsForOrder(current, [...nextInnerToOuter].reverse());
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!draggedVariable) return;
    setDropVariable(dragTargetAt(event.clientX, event.clientY));
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const to = dragTargetAt(event.clientX, event.clientY);
    if (draggedVariable && to) moveDifferential(draggedVariable, to);
    setDraggedVariable(null);
    setDropVariable(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <main className="app-shell">
      {isShared && <SharedBanner />}
      <section className="topbar">
        <div className="topbar-brand">
          <img src="/logo.png" alt="Triple Integral Visualizer logo" className="topbar-logo" />
          <div>
            <p className="eyebrow">Multivariable calculus</p>
            <h1>Triple Integral Visualizer</h1>
          </div>
        </div>
      </section>

      <ErrorBoundary>
        <section className="workspace">
        <section className="equation-panel" aria-label="Triple integral input">
          <div className="coordinate-controls">
            <div className="coordinate-control">
              {pendingCoordinateSystem ? (
                <div
                  className="coordinate-switch-choice"
                  role="group"
                  aria-label={`Switch to ${COORDINATE_LABELS[pendingCoordinateSystem]}`}
                  style={{ '--pending-coordinate-index': COORDINATE_SYSTEMS.indexOf(pendingCoordinateSystem) } as CSSProperties}
                >
                  <div className="coordinate-switch-heading">
                    <span>Switch to {COORDINATE_LABELS[pendingCoordinateSystem]}</span>
                    <button
                      className="coordinate-switch-close"
                      type="button"
                      onClick={() => setPendingCoordinateSystem(null)}
                      aria-label="Cancel coordinate switch"
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="coordinate-switch-actions">
                    <button className="coordinate-switch-action" type="button" onClick={convertToPendingCoordinateSystem}>
                      <ArrowRightLeft size={16} aria-hidden="true" />
                      <span>Convert Current</span>
                    </button>
                    <button className="coordinate-switch-action" type="button" onClick={startFreshInPendingCoordinateSystem}>
                      <FilePlus2 size={16} aria-hidden="true" />
                      <span>Start Fresh</span>
                    </button>
                  </div>
                </div>
              ) : null}
              <div
                className="coordinate-slider"
                role="radiogroup"
                aria-label="Coordinate system"
                style={{ '--coordinate-index': selectedCoordinateIndex } as CSSProperties}
              >
                {COORDINATE_SYSTEMS.map((coordinateSystem) => (
                  <button
                    key={coordinateSystem}
                    className={`${coordinateSystem === input.coordinateSystem ? 'active' : ''}${coordinateSystem === pendingCoordinateSystem ? ' pending' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={coordinateSystem === input.coordinateSystem}
                    onClick={() => updateCoordinateSystem(coordinateSystem)}
                  >
                    {COORDINATE_LABELS[coordinateSystem]}
                  </button>
                ))}
              </div>
            </div>
            <div className="variable-name-row" aria-label="Variable names">
              {variableDrafts.map((name, index) => (
                <input
                  key={`${input.coordinateSystem}-${index}`}
                  aria-label={`Variable ${index + 1}`}
                  value={name}
                  onChange={(event) => updateVariableDraft(index, event.target.value)}
                  onBlur={commitVariableDrafts}
                  onKeyDown={commitOnEnter}
                  spellCheck={false}
                />
              ))}
            </div>
          </div>

          <div className="integral-equation">
            <div className="integral-order-control">
              <div className="integral-stack" aria-label="Integral bounds">
                {outerToInner.map((variable) => (
                  <IntegralBlock
                    key={variable}
                    variable={variable}
                    registerElement={(element) => registerIntegralBlock(variable, element)}
                    lower={input.bounds[variable].lower}
                    upper={input.bounds[variable].upper}
                    isDragging={draggedVariable === variable}
                    isDropTarget={dropVariable === variable && draggedVariable !== variable}
                    onLowerChange={(value) => updateBound(variable, 'lower', value)}
                    onUpperChange={(value) => updateBound(variable, 'upper', value)}
                    onLowerFocus={() => selectExpressionTarget({ kind: 'bound', variable, side: 'lower' })}
                    onUpperFocus={() => selectExpressionTarget({ kind: 'bound', variable, side: 'upper' })}
                    registerLowerInput={(element) => registerExpressionInput({ kind: 'bound', variable, side: 'lower' }, element)}
                    registerUpperInput={(element) => registerExpressionInput({ kind: 'bound', variable, side: 'upper' }, element)}
                  />
                ))}
              </div>
            </div>

            <label className="expression-field integrand-field">
              <span>Integrand</span>
              <MathField
                className="integrand-input"
                placeholder="Integrand"
                value={input.integrand}
                onChange={(value) => setInput({ ...input, integrand: value })}
                onFocus={() => selectExpressionTarget({ kind: 'integrand' })}
              />
            </label>

            <div className="differential-order-control">
              <div className="differentials" aria-label={`Order ${input.selectedOrder}`}>
                {innerToOuter.map((variable) => (
                  <DifferentialToken
                    key={variable}
                    variable={variable}
                    registerElement={(element) => registerDifferential(variable, element)}
                    isDragging={draggedVariable === variable}
                    isDropTarget={dropVariable === variable && draggedVariable !== variable}
                    onPointerDown={(event) => {
                      setDraggedVariable(variable);
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={() => {
                      setDraggedVariable(null);
                      setDropVariable(null);
                    }}
                  />
                ))}
              </div>
              <p className="integral-hint">
                <MoveHorizontal size={15} aria-hidden="true" />
              </p>
            </div>
          </div>

          <SymbolKeyboard onInsert={insertExpressionSnippet} />

          <div className="slice-controls" aria-label="Cross-section controls">
            <label className="slider-control">
              <span>
                Slices <strong>{sliceCount}</strong>
              </span>
              <input
                aria-label="Slice count"
                type="range"
                min="1"
                max={MAX_SLICE_COUNT}
                step="1"
                value={sliceCount}
                onInput={(event) => updateSliceCount(event.currentTarget.value)}
                onChange={(event) => updateSliceCount(event.currentTarget.value)}
              />
            </label>
            <label className="slider-control">
              <span>
                Shown slices <strong>{selectedSlice}/{sliceCount}</strong>
              </span>
              <input
                aria-label="Shown slices"
                type="range"
                min="1"
                max={sliceCount}
                step="1"
                value={selectedSlice}
                onInput={(event) => updateSelectedSlice(event.currentTarget.value)}
                onChange={(event) => updateSelectedSlice(event.currentTarget.value)}
              />
            </label>
            {sliceCount > SLICE_COUNT_WARNING_THRESHOLD ? (
              <p className="status warning slice-warning" aria-live="polite">
                <AlertTriangle size={15} /> More than {SLICE_COUNT_WARNING_THRESHOLD} slices can get slow. Only push higher if your device has the power.
              </p>
            ) : null}
          </div>

          <div className="student-feedback" aria-live="polite">
            {parsed.validationErrors.map((error) => (
              <p className="status error" key={error}>
                <AlertTriangle size={15} /> {error}
              </p>
            ))}
            {sample.warnings.map((warning) => (
              <p className="status warning" key={warning}>
                <AlertTriangle size={15} /> {warning}
              </p>
            ))}
          </div>
        </section>

        <section className="visual-column">
          <div className={`visual-share-panel${shareState === 'copied' ? ' copied' : ''}`}>
            <button
              id="share-equation-button"
              className={`share-button${shareState === 'copied' ? ' copied' : ''}`}
              type="button"
              onClick={handleShare}
              aria-label="Copy shareable equation link"
              aria-describedby="share-link-note"
            >
              {shareState === 'copied' ? (
                <>
                  <Check size={16} aria-hidden="true" />
                  Link Copied
                </>
              ) : (
                <>
                  <Share2 size={16} aria-hidden="true" />
                  Copy Link
                </>
              )}
              <div className="visual-share-copy" id="share-link-note" role="tooltip">
                <Bookmark size={15} aria-hidden="true" />
                <span>{shareState === 'copied' ? 'Link copied. Bookmark it or send it to anyone.' : 'Share this setup, or bookmark the link to save it for later.'}</span>
              </div>
            </button>
          </div>
          <ThreeRegionView
            sample={sample}
            parsed={parsed}
            order={input.selectedOrder}
            opacity={0.68}
            showSlice
            showAllSlices={sliceCount > 1}
            sliceCount={sliceCount}
            visibleSliceCount={selectedSlice}
          />
        </section>

        <aside className="right-rail">
          <section className="answer-panel" aria-label={exact ? 'Exact answer' : 'Estimated answer'}>
            <div className="answer-heading">
              <div className="answer-heading-title">
                <Calculator size={18} />
                <h2>{exact ? 'Exact Answer' : 'Estimate'}</h2>
              </div>
              <button
                className="visibility-toggle"
                type="button"
                onClick={() => setIsResultVisible(!isResultVisible)}
                aria-label={isResultVisible ? 'Hide answer' : 'Show answer'}
                title={isResultVisible ? 'Hide answer' : 'Show answer'}
              >
                {isResultVisible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
            <div className={`answer-value${!isResultVisible ? ' hidden-value' : ''}`}>
              {isResultVisible ? (exact ? exact.fraction : sample.integralEstimate.toFixed(5)) : '•••••'}
            </div>
            {exact && (
              <div className="answer-details">
                <div className="answer-detail-row">
                  <span className={!isResultVisible ? 'hidden-value' : ''}>
                    {isResultVisible ? exact.decimal.toFixed(5) : '•••••'}
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="preset-panel" aria-label="Example regions">
            <div className="preset-heading">
              <h2>Examples</h2>
            </div>
            <div className="preset-grid">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="preset-card"
                  type="button"
                  title={preset.description}
                  onClick={() => setInput(preset.input)}
                >
                  <PresetPreview input={preset.input} />
                  <span className="preset-card-label">{preset.name}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </section>
      </ErrorBoundary>

      <footer className="made-by-credit">
        <span className="credit-text">Made by Nirav with GPT-5.5 for Ms. Augsburger&apos;s 3rd Block Multi, 25-26.</span>
        <div className="credit-links">
          <a href="https://github.com/21J3phy/triple-integral-3d-visualizer" target="_blank" rel="noreferrer">
            <Github size={16} aria-hidden="true" />
            GitHub
          </a>
          <a href="https://www.linkedin.com/in/niravss/" target="_blank" rel="noreferrer">
            <Linkedin size={16} aria-hidden="true" />
            LinkedIn
          </a>
          <a href={BUY_ME_COFFEE_URL} target="_blank" rel="noreferrer">
            <span aria-hidden="true" style={{ fontSize: '16px' }}>📚</span>
            Pay for my Textbooks
          </a>
        </div>
      </footer>
      <Analytics />
    </main>
  );
}


function SharedBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="shared-banner" role="status" aria-live="polite">
      <div className="shared-banner-content">
        <Link size={15} aria-hidden="true" />
        <span>You&apos;re viewing a shared equation. Feel free to edit — your changes won&apos;t affect the original link.</span>
      </div>
      <button
        className="shared-banner-close"
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

interface IntegralBlockProps {
  variable: Variable;
  registerElement: (element: HTMLDivElement | null) => void;
  lower: string;
  upper: string;
  isDragging: boolean;
  isDropTarget: boolean;
  onLowerChange: (value: string) => void;
  onUpperChange: (value: string) => void;
  onLowerFocus: () => void;
  onUpperFocus: () => void;
  registerLowerInput: (element: HTMLInputElement | null) => void;
  registerUpperInput: (element: HTMLInputElement | null) => void;
}

function IntegralBlock({
  variable,
  registerElement,
  lower,
  upper,
  isDragging,
  isDropTarget,
  onLowerChange,
  onUpperChange,
  onLowerFocus,
  onUpperFocus,
  registerLowerInput,
  registerUpperInput,
}: IntegralBlockProps) {
  return (
    <div
      ref={registerElement}
      className={`integral-block${isDragging ? ' dragging' : ''}${isDropTarget ? ' drop-target' : ''}`}
      data-integral-variable={variable}
      role="group"
      aria-label={`${variable} integral`}
    >
      <MathField
        className="bound-input upper"
        placeholder="Upper bound"
        value={upper}
        onChange={onUpperChange}
        onFocus={onUpperFocus}
      />
      <div className="integral-mark">
        <span className="integral-symbol">∫</span>
      </div>
      <MathField
        className="bound-input lower"
        placeholder="Lower bound"
        value={lower}
        onChange={onLowerChange}
        onFocus={onLowerFocus}
      />
      <span className="variable-tag">d{variable}</span>
    </div>
  );
}

interface DifferentialTokenProps {
  variable: Variable;
  registerElement: (element: HTMLButtonElement | null) => void;
  isDragging: boolean;
  isDropTarget: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
}

function DifferentialToken({
  variable,
  registerElement,
  isDragging,
  isDropTarget,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: DifferentialTokenProps) {
  return (
    <button
      ref={registerElement}
      className={`differential-token${isDragging ? ' dragging' : ''}${isDropTarget ? ' drop-target' : ''}`}
      type="button"
      data-differential-variable={variable}
      aria-label={`Move d${variable} differential`}
      title={`Move d${variable}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <GripVertical aria-hidden="true" size={15} />
      <span>d{variable}</span>
    </button>
  );
}

function SymbolKeyboard({ onInsert }: { onInsert: (snippet: string, caretOffset?: number) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <section className="symbol-keyboard" aria-label="Math symbol keyboard">
      <div className="symbol-keyboard-heading">
        <div>
          <h2>
            <Keyboard size={17} aria-hidden="true" />
            Symbol Keyboard
          </h2>
          <p>Tip: you can also type aliases like rho, pi, sqrt(), sin(), cos(), theta, and phi.</p>
        </div>
        <button
          className="symbol-keyboard-toggle"
          type="button"
          aria-expanded={isExpanded}
          aria-controls="symbol-keyboard-groups"
          aria-label={isExpanded ? 'Collapse symbol keyboard' : 'Expand symbol keyboard'}
          title={isExpanded ? 'Collapse symbol keyboard' : 'Expand symbol keyboard'}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </button>
      </div>
      {isExpanded ? (
        <div className="symbol-keyboard-groups" id="symbol-keyboard-groups">
          {SYMBOL_KEYBOARD_GROUPS.map((group) => (
            <div className="symbol-keyboard-group" key={group.label}>
              <span>{group.label}</span>
              <div className="symbol-keyboard-row">
                {group.keys.map((key) => (
                  <button
                    key={`${group.label}-${key.label}-${key.insert}`}
                    className="symbol-key"
                    type="button"
                    title={key.title}
                    aria-label={`Insert ${key.title}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onInsert(key.insert, key.caretOffset)}
                  >
                    {key.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function expressionTargetKey(target: ExpressionTarget): string {
  if (target.kind === 'integrand') return 'integrand';
  return `bound:${target.variable}:${target.side}`;
}

function usableExpressionTarget(target: ExpressionTarget, input: IntegralInput): ExpressionTarget {
  if (target.kind === 'integrand') return target;
  return input.bounds[target.variable] ? target : { kind: 'integrand' };
}

function expressionValue(target: ExpressionTarget, input: IntegralInput): string {
  if (target.kind === 'integrand') return input.integrand;
  return input.bounds[target.variable]?.[target.side] ?? input.integrand;
}

function measureElements<T extends Element>(elements: Partial<Record<Variable, T>>, variables: Variable[]): ElementRects {
  const rects: ElementRects = {};
  for (const variable of variables) {
    rects[variable] = elements[variable]?.getBoundingClientRect();
  }
  return rects;
}

function animateSwappedElements<T extends HTMLElement>(
  previousRects: ElementRects | null,
  elements: Partial<Record<Variable, T>>,
  variables: Variable[],
) {
  if (!previousRects) return;

  for (const variable of variables) {
    const element = elements[variable];
    const previous = previousRects[variable];
    if (!element || !previous) continue;

    const next = element.getBoundingClientRect();
    const deltaX = previous.left - next.left;
    const deltaY = previous.top - next.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;

    element.style.transition = 'none';
    element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    window.requestAnimationFrame(() => {
      element.style.transition = `transform ${SWAP_ANIMATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      element.style.transform = '';
    });
    window.setTimeout(() => {
      element.style.transition = '';
    }, SWAP_ANIMATION_MS + 40);
  }
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function defaultInputForCoordinateSystem(coordinateSystem: CoordinateSystem): IntegralInput {
  const variables = DEFAULT_VARIABLES[coordinateSystem];
  const selectedOrder = orderFromOuterToInner(defaultOuterToInner(coordinateSystem, variables));
  if (coordinateSystem === 'cylindrical') {
    return {
      integrand: variables[0],
      coordinateSystem,
      variables,
      selectedOrder,
      bounds: {
        [variables[0]]: { lower: '0', upper: '1' },
        [variables[1]]: { lower: '0', upper: '2*pi' },
        [variables[2]]: { lower: '0', upper: '1' },
      },
    };
  }
  if (coordinateSystem === 'spherical') {
    return {
      integrand: `${variables[0]}^2 * sin(${variables[2]})`,
      coordinateSystem,
      variables,
      selectedOrder,
      bounds: {
        [variables[0]]: { lower: '0', upper: '1' },
        [variables[1]]: { lower: '0', upper: '2*pi' },
        [variables[2]]: { lower: '0', upper: 'pi' },
      },
    };
  }
  return {
    integrand: '1',
    coordinateSystem,
    variables,
    selectedOrder,
    bounds: {
      [variables[0]]: { lower: '0', upper: '1' },
      [variables[1]]: { lower: '0', upper: '1' },
      [variables[2]]: { lower: '0', upper: '1' },
    },
  };
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="workspace">
          <div className="error-boundary-message">
            <AlertTriangle size={48} />
            <h2>Something went wrong</h2>
            <p>The visualizer encountered an unexpected error. Try refreshing the page or checking your equations.</p>
            <button className="share-button" onClick={() => window.location.reload()}>
              Refresh Page
            </button>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
