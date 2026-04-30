import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { AlertTriangle, Bookmark, Calculator, Check, ChevronDown, ChevronUp, Eye, EyeOff, FilePlus2, Github, GripVertical, History, Keyboard, Link, Linkedin, MoveHorizontal, Share2, Trash2, X } from 'lucide-react';
import { ThreeRegionView } from './components/ThreeRegionView';
import { rewriteBoundsForOrder } from './lib/bounds';
import { COORDINATE_LABELS } from './lib/coordinates';
import { parseIntegral, sampleRegion, solveIntegralExactly } from './lib/integral';
import { orderToOuterInner } from './lib/orders';
import { PRESETS } from './lib/presets';
import { PresetPreview } from './components/PresetPreview';
import { buildShareUrl, copyToClipboard, getSharedEquation, withJacobianDefault } from './lib/sharing';
import { MathField } from './components/MathField';
import { autoReplaceMathSymbols } from './lib/mathSymbols';
import { MAX_SLICE_COUNT } from './lib/sliceGeometry';
import type { CoordinateSystem, IntegralInput, Variable } from './types';

const SHARED_INPUT = getSharedEquation();
const DEFAULT_INPUT = withJacobianDefault(PRESETS[1].input);
const STARTER = withJacobianDefault(SHARED_INPUT ?? DEFAULT_INPUT);
const SAMPLE_COUNT = 8000;
const SWAP_ANIMATION_MS = 260;
const MIN_SLICE_COUNT = 1;
const INITIAL_SLICE_SETTINGS = { sliceCount: 7, selectedSlice: 7 };
const BUY_ME_COFFEE_URL = 'https://buymeacoffee.com/21J3phy';
const COORDINATE_SYSTEMS = Object.keys(COORDINATE_LABELS) as CoordinateSystem[];
const COORDINATE_METADATA: Record<CoordinateSystem, { variables: string; jacobian: string }> = {
  cartesian: { variables: 'x, y, z', jacobian: '1' },
  cylindrical: { variables: 'r, θ, z', jacobian: 'r' },
  spherical: { variables: 'ρ, θ, φ', jacobian: 'ρ² sin(φ)' },
};
const STARTER_DRAFTS = createCoordinateDrafts(STARTER);
const HISTORY_STORAGE_KEY = 'triple-integral-history-v1';
const MAX_SAVED_EQUATIONS = 24;
type ElementRects = Partial<Record<Variable, DOMRect>>;
type BoundSide = 'lower' | 'upper';
type ExpressionTarget = { kind: 'integrand' } | { kind: 'bound'; variable: Variable; side: BoundSide };
type SavedEquation = { id: string; savedAt: number; input: IntegralInput };

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
      { label: '√', insert: 'sqrt', caretOffset: 1, title: 'sqrt' },
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
  const [coordinateDrafts, setCoordinateDrafts] = useState<Record<CoordinateSystem, IntegralInput>>(STARTER_DRAFTS);
  const [draggedVariable, setDraggedVariable] = useState<Variable | null>(null);
  const [dropVariable, setDropVariable] = useState<Variable | null>(null);
  const [savedEquations, setSavedEquations] = useState<SavedEquation[]>(loadSavedEquations);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [workspaceLabel, setWorkspaceLabel] = useState(SHARED_INPUT ? 'Shared integral' : 'Working integral');
  const [{ sliceCount, selectedSlice }, setSliceSettings] = useState(INITIAL_SLICE_SETTINGS);
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
  const activeCoordinateMeta = COORDINATE_METADATA[input.coordinateSystem];


  useEffect(() => {
    saveSavedEquations(savedEquations);
  }, [savedEquations]);

  useEffect(() => {
    setCoordinateDrafts((current) => ({
      ...current,
      [input.coordinateSystem]: cloneInput(input),
    }));
  }, [input]);

  const rememberInput = useCallback((inputToSave: IntegralInput) => {
    setSavedEquations((current) => {
      const savedInput = cloneInput(inputToSave);
      const fingerprint = inputFingerprint(savedInput);
      const nextEntry: SavedEquation = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        savedAt: Date.now(),
        input: savedInput,
      };
      return [nextEntry, ...current.filter((entry) => inputFingerprint(entry.input) !== fingerprint)].slice(0, MAX_SAVED_EQUATIONS);
    });
  }, []);

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
  const switchCoordinateSystem = (coordinateSystem: CoordinateSystem) => {
    if (coordinateSystem === input.coordinateSystem) return;
    setCoordinateDrafts((current) => ({
      ...current,
      [input.coordinateSystem]: cloneInput(input),
    }));
    setInput(cloneInput(coordinateDrafts[coordinateSystem]));
    setWorkspaceLabel(`${COORDINATE_LABELS[coordinateSystem]} integral`);
    setShareState('idle');
  };
  const createNewIntegral = () => {
    rememberInput(input);
    const defaultDrafts = createCoordinateDrafts();
    setCoordinateDrafts(defaultDrafts);
    setInput(cloneInput(defaultDrafts[input.coordinateSystem]));
    setSliceSettings(INITIAL_SLICE_SETTINGS);
    setIsResultVisible(true);
    setShareState('idle');
    setWorkspaceLabel('New integral');
    setIsHistoryOpen(false);
  };
  const restoreSavedEquation = (entry: SavedEquation) => {
    rememberInput(input);
    setInput(cloneInput(entry.input));
    setWorkspaceLabel('Restored saved integral');
    setIsHistoryOpen(false);
  };
  const removeSavedEquation = (entryId: string) => {
    setSavedEquations((current) => current.filter((entry) => entry.id !== entryId));
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
        <div className="topbar-actions">
          <button className="history-toggle-button" type="button" onClick={() => setIsHistoryOpen(true)}>
            <History size={16} aria-hidden="true" />
            <span>Saved Integrals</span>
            {savedEquations.length > 0 ? <span className="history-count">{savedEquations.length}</span> : null}
          </button>
        </div>
      </section>

      {isHistoryOpen ? (
        <>
          <button className="history-backdrop" type="button" aria-label="Close saved integrals" onClick={() => setIsHistoryOpen(false)} />
          <aside className="history-sidebar" aria-label="Saved integrals">
            <div className="history-sidebar-heading">
              <div>
                <p className="eyebrow">Saved</p>
                <h2>Saved Integrals</h2>
              </div>
              <button className="history-close-button" type="button" onClick={() => setIsHistoryOpen(false)} aria-label="Close saved integrals">
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <div className="history-list">
              {savedEquations.length === 0 ? (
                <p className="history-empty">No saved integrals yet.</p>
              ) : (
                savedEquations.map((entry) => (
                  <div className="history-item" key={entry.id}>
                    <button className="history-card" type="button" onClick={() => restoreSavedEquation(entry)}>
                      <span className="history-card-meta">
                        <span>{COORDINATE_LABELS[entry.input.coordinateSystem]}</span>
                        <time dateTime={new Date(entry.savedAt).toISOString()}>{formatSavedAt(entry.savedAt)}</time>
                      </span>
                      <span className="history-card-integrand">{entry.input.integrand || '1'}</span>
                      <span className="history-card-order">{entry.input.selectedOrder}</span>
                    </button>
                    <button
                      className="history-delete-button"
                      type="button"
                      onClick={() => removeSavedEquation(entry.id)}
                      aria-label="Delete saved integral"
                      title="Delete saved integral"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        </>
      ) : null}

      <ErrorBoundary>
        <section className="workspace">
        <section className="equation-panel" aria-label="Triple integral input">
          <div className="workspace-status" key={workspaceLabel} role="status" aria-live="polite">
            <FilePlus2 size={15} aria-hidden="true" />
            <span>{workspaceLabel}</span>
          </div>
          <div className="coordinate-controls">
            <div className="coordinate-control">
              <div className="coordinate-card-grid" role="group" aria-label="Coordinate system" aria-describedby="coordinate-mode-summary">
                {COORDINATE_SYSTEMS.map((coordinateSystem) => {
                  const isActive = coordinateSystem === input.coordinateSystem;
                  const label = COORDINATE_LABELS[coordinateSystem];
                  const metadata = COORDINATE_METADATA[coordinateSystem];
                  return (
                    <button
                      key={coordinateSystem}
                      className={`coordinate-system-card${isActive ? ' active' : ''}`}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => switchCoordinateSystem(coordinateSystem)}
                    >
                      <span className="coordinate-card-heading">
                        <span className="coordinate-card-name">{label}</span>
                        <span className="coordinate-card-state">
                          {isActive ? (
                            <>
                              <Check size={14} aria-hidden="true" />
                              Selected
                            </>
                          ) : 'Use'}
                        </span>
                      </span>
                      <span className="coordinate-card-details">
                        <span>
                          Coordinates <strong>{metadata.variables}</strong>
                        </span>
                        <span>
                          Volume factor <strong>{metadata.jacobian}</strong>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="coordinate-mode-summary" id="coordinate-mode-summary">
                {COORDINATE_LABELS[input.coordinateSystem]} coordinates use {activeCoordinateMeta.variables}; volume factor {activeCoordinateMeta.jacobian}.
              </p>
            </div>
            <button className="new-integral-button" type="button" onClick={createNewIntegral}>
              <FilePlus2 size={16} aria-hidden="true" />
              <span>New Integral</span>
            </button>
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
              <span>Function to integrate</span>
              <MathField
                className="integrand-input"
                placeholder="f(x, y, z)"
                value={input.integrand}
                onChange={(value) => setInput({ ...input, integrand: value })}
                onFocus={() => selectExpressionTarget({ kind: 'integrand' })}
                inputRef={(element) => registerExpressionInput({ kind: 'integrand' }, element)}
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
                Cross-section count <strong>{sliceCount}</strong>
              </span>
              <input
                aria-label="Number of cross-sections"
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
                Cross-sections shown <strong>{selectedSlice}/{sliceCount}</strong>
              </span>
              <input
                aria-label="Visible cross-sections"
                type="range"
                min="1"
                max={sliceCount}
                step="1"
                value={selectedSlice}
                onInput={(event) => updateSelectedSlice(event.currentTarget.value)}
                onChange={(event) => updateSelectedSlice(event.currentTarget.value)}
              />
            </label>
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
              aria-label="Copy shareable integral link"
              aria-describedby="share-link-note"
            >
              {shareState === 'copied' ? (
                <>
                  <Check size={16} aria-hidden="true" />
                  Link copied
                </>
              ) : (
                <>
                  <Share2 size={16} aria-hidden="true" />
                  Share Integral
                </>
              )}
              <div className="visual-share-copy" id="share-link-note" role="tooltip">
                <Bookmark size={15} aria-hidden="true" />
                <span>{shareState === 'copied' ? 'Link copied. Bookmark it or send it to anyone.' : 'Share this integral, or bookmark the link to save it for later.'}</span>
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
          <section className="answer-panel" aria-label={exact ? 'Exact integral value' : 'Estimated integral value'}>
            <div className="answer-heading">
              <div className="answer-heading-title">
                <Calculator size={18} />
                <h2>{exact ? 'Exact Value' : 'Estimated Value'}</h2>
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

          <section className="preset-panel" aria-label="Example integrals">
            <div className="preset-heading">
              <h2>Example Integrals</h2>
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
        <span>You&apos;re viewing a shared integral. Feel free to edit — your changes won&apos;t affect the original link.</span>
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
        placeholder="Upper"
        value={upper}
        onChange={onUpperChange}
        onFocus={onUpperFocus}
        inputRef={registerUpperInput}
      />
      <div className="integral-mark">
        <span className="integral-symbol">∫</span>
      </div>
      <MathField
        className="bound-input lower"
        placeholder="Lower"
        value={lower}
        onChange={onLowerChange}
        onFocus={onLowerFocus}
        inputRef={registerLowerInput}
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
      aria-label={`Move d${variable} in the integration order`}
      title={`Move d${variable} in the order`}
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
            Math Shortcuts
          </h2>
          <p>Type aliases like rho, theta, phi, pi, sqrt(), sin(), and cos().</p>
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

function loadSavedEquations(): SavedEquation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedEquation).slice(0, MAX_SAVED_EQUATIONS);
  } catch {
    return [];
  }
}

function saveSavedEquations(entries: SavedEquation[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Keeping the app usable matters more than surfacing localStorage failures.
  }
}

function isSavedEquation(value: unknown): value is SavedEquation {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SavedEquation>;
  return typeof entry.id === 'string' && typeof entry.savedAt === 'number' && Number.isFinite(entry.savedAt) && isIntegralInput(entry.input);
}

function isIntegralInput(value: unknown): value is IntegralInput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<IntegralInput>;
  return (
    typeof candidate.integrand === 'string' &&
    typeof candidate.coordinateSystem === 'string' &&
    COORDINATE_SYSTEMS.includes(candidate.coordinateSystem as CoordinateSystem) &&
    Array.isArray(candidate.variables) &&
    candidate.variables.length === 3 &&
    candidate.variables.every((variable) => typeof variable === 'string') &&
    typeof candidate.selectedOrder === 'string' &&
    !!candidate.bounds &&
    typeof candidate.bounds === 'object'
  );
}

function cloneInput(input: IntegralInput): IntegralInput {
  return JSON.parse(JSON.stringify(input)) as IntegralInput;
}

function createCoordinateDrafts(activeInput?: IntegralInput): Record<CoordinateSystem, IntegralInput> {
  const drafts = Object.fromEntries(
    COORDINATE_SYSTEMS.map((coordinateSystem) => [coordinateSystem, defaultInputForCoordinateSystem(coordinateSystem)]),
  ) as Record<CoordinateSystem, IntegralInput>;
  if (activeInput) drafts[activeInput.coordinateSystem] = cloneInput(activeInput);
  return drafts;
}

function defaultInputForCoordinateSystem(coordinateSystem: CoordinateSystem): IntegralInput {
  if (coordinateSystem === 'cartesian') return cloneInput(DEFAULT_INPUT);
  const preset = PRESETS.find((entry) => entry.input.coordinateSystem === coordinateSystem) ?? PRESETS[0];
  return cloneInput(withJacobianDefault(preset.input));
}

function inputFingerprint(input: IntegralInput): string {
  return JSON.stringify(input);
}

function formatSavedAt(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
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
