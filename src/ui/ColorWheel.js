import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// HSV colour wheel: angle = hue, radius = saturation, slider = brightness.
// Keeps its own HSV state so hue survives at zero saturation/brightness
// (a hex round-trip would lose it).
import { useEffect, useRef, useState } from 'react';
import { hexToHsv, hsvToHex, normalizeHex } from '../lib/color';
const EyeDropper = window.EyeDropper;
export function ColorWheel({ value, onChange }) {
    const [hsv, setHsv] = useState(() => hexToHsv(value ?? '#FFFFFF'));
    const [hexText, setHexText] = useState(() => hsvToHex(hsv));
    // Follow external changes (presets, undo, other users) without clobbering hue.
    useEffect(() => {
        if (!value)
            return;
        const hex = normalizeHex(value);
        if (hex && hex !== hsvToHex(hsv)) {
            setHsv(hexToHsv(hex));
            setHexText(hex);
        }
    }, [value]);
    const commit = (next) => {
        setHsv(next);
        const hex = hsvToHex(next);
        setHexText(hex);
        onChange(hex);
    };
    const wheelRef = useRef(null);
    const sliderRef = useRef(null);
    const fromWheel = (e) => {
        const r = wheelRef.current.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
        commit({ h, s, v: hsv.v || 1 });
    };
    const fromSlider = (e) => {
        const r = sliderRef.current.getBoundingClientRect();
        commit({ ...hsv, v: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) });
    };
    // Drag helper: capture the pointer and re-run the handler while held.
    const drag = (handler) => ({
        onPointerDown: (e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            handler(e);
        },
        onPointerMove: (e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
                handler(e);
        },
    });
    const rad = (hsv.h * Math.PI) / 180;
    const current = hsvToHex(hsv);
    const pureHue = hsvToHex({ h: hsv.h, s: hsv.s, v: 1 });
    return (_jsxs("div", { className: "color-wheel", children: [_jsxs("div", { ref: wheelRef, className: "wheel", ...drag(fromWheel), children: [_jsx("div", { className: "wheel-shade", style: { opacity: 1 - hsv.v } }), _jsx("div", { className: "wheel-handle", style: {
                            left: `${50 + Math.cos(rad) * hsv.s * 50}%`,
                            top: `${50 + Math.sin(rad) * hsv.s * 50}%`,
                            background: current,
                        } })] }), _jsx("div", { ref: sliderRef, className: "value-slider", style: { background: `linear-gradient(to right, #000, ${pureHue})` }, ...drag(fromSlider), role: "slider", "aria-label": "Brightness", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(hsv.v * 100), children: _jsx("div", { className: "value-handle", style: { left: `${hsv.v * 100}%`, background: current } }) }), _jsxs("div", { className: "hex-row", children: [_jsx("span", { className: "hex-preview", style: { background: current } }), _jsx("input", { className: "hex-input mono", value: hexText, spellCheck: false, maxLength: 7, onChange: (e) => {
                            setHexText(e.target.value);
                            const hex = normalizeHex(e.target.value);
                            if (hex && e.target.value.replace('#', '').length === 6) {
                                setHsv(hexToHsv(hex));
                                onChange(hex);
                            }
                        }, onBlur: () => setHexText(current), onKeyDown: (e) => {
                            if (e.key !== 'Enter')
                                return;
                            const hex = normalizeHex(hexText);
                            if (hex) {
                                setHsv(hexToHsv(hex));
                                setHexText(hex);
                                onChange(hex);
                            }
                        } }), EyeDropper && (_jsx("button", { className: "icon-btn", title: "Pick a colour from the screen", "aria-label": "Eyedropper", onClick: async () => {
                            try {
                                const { sRGBHex } = await new EyeDropper().open();
                                const hex = normalizeHex(sRGBHex);
                                if (hex)
                                    commit(hexToHsv(hex));
                            }
                            catch { } // user cancelled
                        }, children: _jsxs("svg", { viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("path", { d: "m2 22 1-1h3l9-9" }), _jsx("path", { d: "M3 21v-3l9-9" }), _jsx("path", { d: "m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" })] }) }))] })] }));
}
