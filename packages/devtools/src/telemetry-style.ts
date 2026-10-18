export const telemetryStyle = `
.telemetry-view{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px 2px 12px;container-type:inline-size}
.telemetry-view:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.telemetry-dashboard{max-width:1440px;margin:0 auto;--telemetry-line:color-mix(in srgb,var(--accent) 28%,var(--border))}
.telemetry-dashboard svg,.telemetry-message svg{width:22px;height:22px;flex-shrink:0}
.telemetry-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:2px 0 18px}
.telemetry-heading h2{font-size:23px;letter-spacing:-.6px;line-height:1.25;margin:4px 0 0}
.telemetry-eyebrow{font-size:10px;font-weight:650;letter-spacing:1.3px;text-transform:uppercase;color:var(--muted);margin:0}
.telemetry-state{margin:0;border:1px solid var(--telemetry-line);background:var(--soft);border-radius:999px;color:var(--accent);padding:5px 11px;white-space:nowrap}
.telemetry-state dd{display:flex;align-items:center;gap:7px;margin:0;font-weight:650;font-size:12px}
.telemetry-state dd:before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.telemetry-sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.telemetry-status{display:grid;grid-template-columns:36px 1fr;column-gap:12px;align-items:center;margin-bottom:18px}
.telemetry-status>svg{grid-row:1/3;width:36px;height:36px;padding:7px;border-radius:10px;background:var(--soft);color:var(--accent)}
.telemetry-status h3{font-size:14px;margin:0 0 2px}.telemetry-status p{font-size:12px;color:var(--muted);margin:0;max-width:880px}
.telemetry-flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:26px;margin:0 0 22px}
.telemetry-metric{position:relative;min-width:0;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.telemetry-metric:after{content:'→';position:absolute;right:-23px;top:50%;transform:translateY(-50%);width:20px;text-align:center;font-size:18px;color:var(--muted)}
.telemetry-metric:last-child:after{display:none}
.telemetry-metric dt{font-size:12px;font-weight:550;color:var(--muted);padding-right:22px}
.telemetry-value{font-size:36px;font-weight:650;letter-spacing:-1.3px;line-height:1.2;font-variant-numeric:tabular-nums;margin:10px 0 14px;overflow-wrap:anywhere}
.telemetry-metric[data-large=true] .telemetry-value{font-size:23px;letter-spacing:-.5px}
.telemetry-metric-note{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center;font-size:11px;line-height:1.5;color:var(--muted);margin:0}
.telemetry-metric-note svg{position:absolute;right:14px;top:14px;width:18px;height:18px;color:var(--muted)}
.telemetry-scope{font-size:9px;font-weight:650;letter-spacing:.5px;text-transform:uppercase;padding:1px 5px;border-radius:4px;background:var(--bg);border:1px solid var(--border)}
.telemetry-acknowledged{border-color:var(--telemetry-line);background:linear-gradient(135deg,var(--surface),var(--soft))}
.telemetry-acknowledged .telemetry-value,.telemetry-acknowledged .telemetry-metric-note svg{color:var(--accent)}
.telemetry-dashboard[data-exporting=true] .telemetry-metric:nth-child(3){border-color:var(--telemetry-line)}
.telemetry-dashboard[data-exporting=true] .telemetry-metric:nth-child(3):after{color:var(--accent);animation:telemetry-transfer 1.4s ease-in-out infinite}
@keyframes telemetry-transfer{0%,100%{opacity:.4;translate:-2px 0}50%{opacity:1;translate:2px 0}}
.telemetry-lower{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(230px,1fr);gap:22px}
.telemetry-ledger{min-width:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--surface)}
.telemetry-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px 10px}
.telemetry-section-heading h3{font-size:13px;margin:0}.telemetry-loss-total{font-size:11px;font-weight:650;color:var(--muted);font-variant-numeric:tabular-nums}
.telemetry-dashboard[data-loss=true] .telemetry-loss-total{color:var(--warning);background:color-mix(in srgb,var(--warning) 10%,transparent);border-radius:4px;padding:2px 7px}
.telemetry-loss-rows{margin:0 16px}
.telemetry-loss-rows>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 16px;padding:9px 0;border-top:1px solid var(--border)}
.telemetry-loss-rows dt{font-weight:550;font-size:12px}.telemetry-loss-count{margin:0;font-size:14px;font-weight:650;font-variant-numeric:tabular-nums}
.telemetry-loss-rows>div[data-loss=true] .telemetry-loss-count{color:var(--warning)}
.telemetry-loss-description{grid-column:1/-1;margin:0;color:var(--muted);font-size:11px}
.telemetry-loss-track{grid-column:1/-1;overflow:hidden;height:3px;background:var(--bg);border-radius:3px;margin:5px 0 0}
.telemetry-loss-track span{display:block;height:100%;border-radius:3px;background:var(--warning);transition:width .3s ease}
.telemetry-no-loss{display:grid;grid-template-columns:30px 1fr;gap:0 10px;padding:16px}
.telemetry-no-loss svg{grid-row:1/3;color:var(--accent);width:28px;height:28px;padding:4px;background:var(--soft);border-radius:50%}
.telemetry-no-loss span{font-weight:550;font-size:12px}.telemetry-no-loss small{color:var(--muted);font-size:11px}
.telemetry-disclosure{margin:10px 16px 14px;padding:0;border:0;background:none;color:var(--muted);font-size:11px;text-decoration:underline;text-underline-offset:3px}
.telemetry-disclosure:hover{color:var(--accent)}
.telemetry-guide{padding:12px 0;color:var(--muted);font-size:12px}.telemetry-guide h3{font-size:14px;color:var(--text);margin:7px 0}
.telemetry-guide p{margin:0 0 12px;max-width:54ch}.telemetry-persistence{border-left:2px solid var(--telemetry-line);padding-left:12px}
.telemetry-limits{border-top:1px solid var(--border);padding-top:10px}.telemetry-limits summary{cursor:pointer;color:var(--text);font-size:12px}.telemetry-limits p{margin-top:10px;font-size:11px}
.telemetry-refresh{font-size:10px;color:var(--muted);letter-spacing:.2px;margin:18px 0 0}
.telemetry-trends{margin:0 0 24px;padding:18px;border:1px solid var(--border);border-radius:12px;background:var(--surface);min-width:0}
.telemetry-trend-heading{display:flex;align-items:start;justify-content:space-between;gap:16px}.telemetry-trend-heading h3{font-size:16px;margin:0 0 4px}.telemetry-trend-heading button{white-space:nowrap}.telemetry-trend-heading button[aria-pressed=true]{color:var(--accent);background:var(--soft)}
.telemetry-window{margin:0;font-size:12px;font-variant-numeric:tabular-nums}.telemetry-window-times,.telemetry-retention{font-size:11px;color:var(--muted);margin:6px 0 12px}
.telemetry-gaps{font-size:11px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;color:var(--warning);background:var(--bg)}
.telemetry-window-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.telemetry-window-totals>div{padding:12px;background:var(--bg);border-radius:8px;min-width:0}.telemetry-window-totals dt{font-size:11px;color:var(--muted)}.telemetry-window-totals dd{font-size:18px;font-weight:600;margin:6px 0 0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.telemetry-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.telemetry-chart{margin:0;min-width:0;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg);overscroll-behavior:contain}.telemetry-chart h4{margin:0 0 8px;font-size:12px}.telemetry-legend{display:flex;flex-wrap:wrap;gap:8px 14px;font-size:10px;color:var(--muted)}.telemetry-legend span:before{content:'';display:inline-block;width:12px;height:3px;margin:0 5px 2px 0;background:var(--series-color);border-radius:2px}
.telemetry-dashboard .telemetry-chart svg{display:block;width:100%;height:auto;min-width:420px;margin:12px 0 4px;cursor:crosshair}.telemetry-axis{fill:var(--muted);font:16px ui-monospace,monospace}.telemetry-gridline{stroke:var(--border);stroke-width:1}.telemetry-cursor{stroke:var(--accent);stroke-width:1;stroke-dasharray:4 4;opacity:.65}.telemetry-chart figcaption{font-size:10px;color:var(--muted)}
.telemetry-exploration{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(240px,1fr);gap:16px;align-items:start}.telemetry-sample-scroll{max-height:280px;min-width:0;overflow:auto;border:1px solid var(--border);border-radius:8px;overscroll-behavior:contain}.telemetry-sample-scroll table{width:100%;min-width:690px;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums}.telemetry-sample-scroll th{position:sticky;top:0;z-index:1;background:var(--surface);font-weight:600;text-align:left;color:var(--muted)}.telemetry-sample-scroll :is(td,th){padding:8px;white-space:nowrap;border-bottom:1px solid var(--border)}.telemetry-sample-scroll button{font-size:11px;white-space:nowrap}.telemetry-sample-scroll button[aria-pressed=true]{color:var(--accent);border-color:var(--accent);background:var(--soft)}
.telemetry-sample-detail{min-width:0;border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg)}.telemetry-sample-detail h4{margin:0;font-size:12px}.telemetry-sample-detail p{margin:6px 0 10px;font-size:11px;color:var(--muted)}.telemetry-sample-detail pre{max-height:245px;overflow:auto;overscroll-behavior:contain;white-space:pre;font:11px/1.6 ui-monospace,monospace;margin:0;tab-size:2}.telemetry-sample-detail pre:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.telemetry-sample-detail h5{font-size:11px;font-weight:600;margin:12px 0 8px}.telemetry-sample-interval{margin:0 0 14px;font-size:11px;font-variant-numeric:tabular-nums}.telemetry-sample-interval>div{display:flex;justify-content:space-between;gap:12px;margin:6px 0}.telemetry-sample-interval dt{color:var(--muted)}.telemetry-sample-interval dd{margin:0;text-align:right;overflow-wrap:anywhere}
@container(max-width:900px){.telemetry-charts,.telemetry-exploration{grid-template-columns:minmax(0,1fr)}.telemetry-dashboard .telemetry-chart svg{min-width:360px}.telemetry-sample-detail pre{max-height:210px}}
@container(max-width:500px){.telemetry-trends{padding:12px}.telemetry-window-totals{grid-template-columns:minmax(0,1fr);gap:6px}.telemetry-window-totals>div{display:flex;justify-content:space-between;align-items:center;gap:10px}.telemetry-window-totals dd{margin:0;font-size:14px}.telemetry-trend-heading{gap:8px}.telemetry-trend-heading button{font-size:11px}}
.telemetry-dashboard[data-state=timed_out] .telemetry-state{background:color-mix(in srgb,var(--danger) 8%,var(--surface));border-color:color-mix(in srgb,var(--danger) 40%,var(--border));color:var(--danger)}
.telemetry-dashboard[data-state=timed_out] .telemetry-status>svg{color:var(--danger);background:color-mix(in srgb,var(--danger) 8%,var(--surface))}
.telemetry-dashboard:is([data-state=disabled],[data-state=disposed]) .telemetry-state{background:var(--surface);border-color:var(--border);color:var(--muted)}
.telemetry-dashboard:is([data-state=disabled],[data-state=disposed]) .telemetry-status>svg{color:var(--muted);background:var(--surface)}
.telemetry-message{max-width:600px;margin:42px auto;padding:30px;border:1px solid var(--border);border-radius:12px;background:var(--surface);text-align:center}
.telemetry-message>svg{width:44px;height:44px;color:var(--muted);padding:8px;background:var(--bg);border-radius:12px;margin-bottom:15px}.telemetry-message h2{font-size:19px;margin-bottom:10px}.telemetry-message p{color:var(--muted);margin-bottom:18px}.telemetry-message code{display:inline-block;color:var(--accent);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 14px;font:12px ui-monospace,monospace}
@container(max-width:760px){.telemetry-flow{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.telemetry-metric:after{display:none}.telemetry-lower{grid-template-columns:minmax(0,1fr);gap:8px}.telemetry-value{font-size:30px}.telemetry-guide{padding:12px 3px}.telemetry-heading h2{font-size:20px}.telemetry-metric{padding:14px}.telemetry-metric dt{min-height:36px}.telemetry-value{margin-top:2px}.telemetry-status{align-items:start}.telemetry-message{margin:18px 0;padding:24px 16px}}
@container(max-width:380px){.telemetry-heading{gap:8px}.telemetry-heading h2{font-size:18px}.telemetry-eyebrow{font-size:9px;letter-spacing:.6px}.telemetry-state{padding:4px 8px}.telemetry-metric{padding:12px}.telemetry-metric-note svg{display:none}.telemetry-metric dt{padding-right:0}.telemetry-value{font-size:28px}}
@media(prefers-reduced-motion:reduce){.telemetry-dashboard *,.telemetry-dashboard *:after{animation:none!important;transition:none!important}}
`;
