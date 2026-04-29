import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AlertTriangle, Calculator, Github, GripVertical, Linkedin } from 'lucide-react';
import { ThreeRegionView } from './components/ThreeRegionView';
import { rewriteBoundsForOrder, rewriteVariables } from './lib/bounds';
import { areValidVariables, convertIntegralToCoordinateSystem, COORDINATE_LABELS, DEFAULT_VARIABLES, defaultOuterToInner } from './lib/coordinates';
import { parseIntegral, sampleRegion } from './lib/integral';
import { orderFromOuterToInner, orderToOuterInner } from './lib/orders';
import { PRESETS } from './lib/presets';
import type { CoordinateSystem, IntegralInput, Variable } from './types';

const STARTER = PRESETS[1].input;
const SAMPLE_COUNT = 8000;
const SWAP_ANIMATION_MS = 260;
const MIN_SLICE_COUNT = 1;
const MAX_SLICE_COUNT = 100;
const SLICE_COUNT_WARNING_THRESHOLD = 20;
const BUY_ME_COFFEE_URL = 'https://buymeacoffee.com/21J3phy';
type ElementRects = Partial<Record<Variable, DOMRect>>;

export function App() {
  const [input, setInput] = useState<IntegralInput>(STARTER);
  const [variableDrafts, setVariableDrafts] = useState<[string, string, string]>(STARTER.variables);
  const [draggedVariable, setDraggedVariable] = useState<Variable | null>(null);
  const [dropVariable, setDropVariable] = useState<Variable | null>(null);
  const [{ sliceCount, selectedSlice }, setSliceSettings] = useState({ sliceCount: 7, selectedSlice: 4 });
  const integralRefs = useRef<Partial<Record<Variable, HTMLDivElement>>>({});
  const differentialRefs = useRef<Partial<Record<Variable, HTMLSpanElement>>>({});
  const previousIntegralRects = useRef<ElementRects | null>(null);
  const previousDifferentialRects = useRef<ElementRects | null>(null);

  const parsed = useMemo(() => parseIntegral(input), [input]);
  const sample = useMemo(() => sampleRegion(parsed, SAMPLE_COUNT), [parsed]);
  const variables = input.variables;
  const outerToInner = orderToOuterInner(input.selectedOrder);
  const innerToOuter = [...outerToInner].reverse();

  useEffect(() => {
    setVariableDrafts(input.variables);
  }, [input.variables]);

  const updateBound = (variable: Variable, side: 'lower' | 'upper', value: string) => {
    setInput((current) => ({
      ...current,
      bounds: {
        ...current.bounds,
        [variable]: { ...current.bounds[variable], [side]: value },
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
    setInput((current) => convertIntegralToCoordinateSystem(current, coordinateSystem));
  };
  const updateVariableDraft = (index: number, value: string) => {
    const nextDrafts = variableDrafts.map((name, itemIndex) => (itemIndex === index ? value : name)) as [string, string, string];
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

  const captureSwapRects = () => {
    previousIntegralRects.current = measureElements(integralRefs.current, variables);
    previousDifferentialRects.current = measureElements(differentialRefs.current, variables);
  };

  const registerIntegralBlock = (variable: Variable, element: HTMLDivElement | null) => {
    if (element) integralRefs.current[variable] = element;
    else delete integralRefs.current[variable];
  };

  const registerDifferential = (variable: Variable, element: HTMLSpanElement | null) => {
    if (element) differentialRefs.current[variable] = element;
    else delete differentialRefs.current[variable];
  };

  const moveVariable = (from: Variable, to: Variable) => {
    if (from === to) return;
    captureSwapRects();
    setInput((current) => {
      const nextOuterToInner = orderToOuterInner(current.selectedOrder);
      const fromIndex = nextOuterToInner.indexOf(from);
      const toIndex = nextOuterToInner.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return current;
      nextOuterToInner.splice(fromIndex, 1);
      nextOuterToInner.splice(toIndex, 0, from);
      return rewriteBoundsForOrder(current, nextOuterToInner);
    });
  };

  useLayoutEffect(() => {
    animateSwappedElements(previousIntegralRects.current, integralRefs.current, variables);
    animateSwappedElements(previousDifferentialRects.current, differentialRefs.current, variables);
    previousIntegralRects.current = null;
    previousDifferentialRects.current = null;
  }, [outerToInner.join('|'), variables]);

  const dragTargetAt = (clientX: number, clientY: number): Variable | null => {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-integral-variable]');
    const variable = element?.dataset.integralVariable;
    return variable && variables.includes(variable) ? variable : null;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggedVariable) return;
    setDropVariable(dragTargetAt(event.clientX, event.clientY));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const to = dragTargetAt(event.clientX, event.clientY);
    if (draggedVariable && to) moveVariable(draggedVariable, to);
    setDraggedVariable(null);
    setDropVariable(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Multivariable calculus</p>
          <h1>Triple Integral Visualizer</h1>
        </div>
        <div className="preset-row" aria-label="Example regions">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              className="preset-button"
              type="button"
              title={preset.description}
              onClick={() => setInput(preset.input)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section className="workspace">
        <section className="equation-panel" aria-label="Triple integral input">
          <div className="coordinate-controls">
            <label className="select-control">
              <span>Coordinates</span>
              <select
                aria-label="Coordinate system"
                value={input.coordinateSystem}
                onChange={(event) => updateCoordinateSystem(event.target.value as CoordinateSystem)}
              >
                {(Object.keys(COORDINATE_LABELS) as CoordinateSystem[]).map((coordinateSystem) => (
                  <option key={coordinateSystem} value={coordinateSystem}>
                    {COORDINATE_LABELS[coordinateSystem]}
                  </option>
                ))}
              </select>
            </label>
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
            <div className="integral-stack" aria-label="Drag integrals to change order">
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

            <input
              className="integrand-input"
              aria-label="Integrand"
              value={input.integrand}
              onChange={(event) => setInput({ ...input, integrand: event.target.value })}
              spellCheck={false}
            />

            <div className="differentials" aria-label={`Order ${input.selectedOrder}`}>
              {innerToOuter.map((variable) => (
                <span key={variable} ref={(element) => registerDifferential(variable, element)}>
                  d{variable}
                </span>
              ))}
            </div>
          </div>

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

        <aside className="answer-panel" aria-label="Estimated answer">
          <div className="answer-heading">
            <Calculator size={18} />
            <h2>Estimate</h2>
          </div>
          <div className="answer-value">{sample.integralEstimate.toFixed(5)}</div>
          <div className="answer-details">
            <span>Volume {sample.estimatedVolume.toFixed(5)}</span>
            <span>Jacobian {sample.jacobianLabel}</span>
            <span>{COORDINATE_LABELS[input.coordinateSystem]}</span>
          </div>
        </aside>
      </section>

      <footer className="made-by-credit">
        <div className="credit-links">
          <span>Made by Nirav with GPT-5.5 for Ms. Augsburger&apos;s 3rd Block Multi, 25-26.</span>
          <a href="https://github.com/21J3phy/triple-integral-3d-visualizer" target="_blank" rel="noreferrer">
            <Github size={16} aria-hidden="true" />
            GitHub
          </a>
          <a href="https://www.linkedin.com/in/niravss/" target="_blank" rel="noreferrer">
            <Linkedin size={16} aria-hidden="true" />
            LinkedIn
          </a>
        </div>
        <SupportPanel />
      </footer>
    </main>
  );
}

function SupportPanel() {
  return (
    <div className="footer-support" aria-label="Support this project">
      <a className="bmc-footer-button" href={BUY_ME_COFFEE_URL} target="_blank" rel="noreferrer">
        <span aria-hidden="true">📚</span>
        Pay for my Textbooks
      </a>
      <img className="support-qr" src="/qr-code.png" alt="Buy Me a Coffee QR code" />
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
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
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
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: IntegralBlockProps) {
  return (
    <div
      ref={registerElement}
      className={`integral-block${isDragging ? ' dragging' : ''}${isDropTarget ? ' drop-target' : ''}`}
      data-integral-variable={variable}
      role="group"
      aria-label={`${variable} integral`}
    >
      <input
        className="bound-input upper"
        aria-label={`${variable} upper bound`}
        value={upper}
        onChange={(event) => onUpperChange(event.target.value)}
        spellCheck={false}
      />
      <div
        className="integral-mark"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <GripVertical aria-hidden="true" size={18} />
        <span className="integral-symbol">∫</span>
      </div>
      <input
        className="bound-input lower"
        aria-label={`${variable} lower bound`}
        value={lower}
        onChange={(event) => onLowerChange(event.target.value)}
        spellCheck={false}
      />
      <span className="variable-tag">d{variable}</span>
    </div>
  );
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
      integrand: '1',
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
      integrand: '1',
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
