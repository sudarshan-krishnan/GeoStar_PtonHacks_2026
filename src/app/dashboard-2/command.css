/* HAVEN incident command in the deployed Command Center (incident-command.tsx).
   Uses the Smart Blocks tokens from smart-blocks.css; layout falls back sensibly without them. */

/* ---------- shared atoms ---------- */
.d2-shell .cc-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 100px;
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  white-space: nowrap;
  background: rgba(18, 22, 36, 0.05);
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-chip i,
.d2-shell .cc-dot,
.d2-shell .cc-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
  flex: none;
}
.d2-shell .cc-online {
  background: var(--sb-blue-soft, #e8f0ff);
  color: var(--sb-blue-strong, #1859e6);
}
.d2-shell .cc-safe {
  background: #e6f6ec;
  color: #1d7a45;
}
.d2-shell .cc-warning {
  background: var(--sb-amber-soft, #fff2d9);
  color: var(--sb-amber-deep, #8f4f00);
}
.d2-shell .cc-offline,
.d2-shell .cc-critical {
  background: var(--sb-red-soft, #ffeceb);
  color: #b4232a;
}
.d2-shell .cc-dot.online {
  color: var(--sb-blue, #2f7bff);
}
.d2-shell .cc-dot.warning {
  color: var(--sb-amber-strong, #e88a00);
}
.d2-shell .cc-dot.offline {
  color: var(--sb-red, #e5484d);
}
.d2-shell .cc-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 100px;
  font-size: 10.5px;
  font-weight: 600;
  white-space: nowrap;
}
.d2-shell .cc-badge.green {
  background: #e6f6ec;
  color: #1d7a45;
}
.d2-shell .cc-badge.amber {
  background: var(--sb-amber-soft, #fff2d9);
  color: var(--sb-amber-deep, #8f4f00);
}
.d2-shell .cc-badge.red {
  background: var(--sb-red-soft, #ffeceb);
  color: #b4232a;
}
.d2-shell .cc-badge.red i {
  animation: cc-blink 1.1s ease-in-out infinite;
}
.d2-shell .cc-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.d2-shell .cc-label h3 {
  font-size: 13px;
  font-weight: 650;
  color: var(--sb-ink, #121624);
}
.d2-shell .cc-label > span:not(.cc-badge):not(.cc-plan-status) {
  font-size: 10px;
  color: var(--sb-faint, #a2a8b6);
  letter-spacing: 0.04em;
}
.d2-shell .cc-overview code,
.d2-shell .cc-command code,
.d2-shell .cc-coordination code,
.d2-shell .cc-strip code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: var(--sb-ink-2, #343a4c);
}

/* ---------- status strip (extends .hv-health-banner) ---------- */
.d2-shell .hv-health-banner.cc-strip {
  position: relative;
  flex-direction: column;
  align-items: stretch;
  gap: 16px;
}
.d2-shell .hv-health-banner.cc-strip > div {
  flex: none;
}
.d2-shell .cc-strip-main {
  display: flex;
  align-items: center;
  gap: 16px;
}
.d2-shell .cc-strip-main > div {
  flex: 1;
  min-width: 0;
}
.d2-shell .cc-strip-main b em {
  font-style: normal;
  font-weight: 500;
  color: var(--sb-ink-2, #343a4c);
}
.d2-shell .cc-orb {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  flex: none;
  color: #fff;
  background: linear-gradient(150deg, var(--sb-blue-hi, #6aa6ff), var(--sb-blue-strong, #1859e6));
  box-shadow: 0 1px 2px rgba(47, 123, 255, 0.25);
}
.d2-shell .hv-health-banner.warning .cc-orb {
  background: linear-gradient(150deg, var(--sb-amber-hi, #ffc75a), var(--sb-amber-strong, #e88a00));
}
.d2-shell .hv-health-banner.critical .cc-orb {
  background: linear-gradient(150deg, #ff8a7a, var(--sb-red, #e5484d));
}
.d2-shell .cc-orb.alert {
  animation: cc-pulse 1.6s ease-in-out infinite;
}
.d2-shell .cc-strip-metrics {
  display: grid;
  grid-template-columns: minmax(170px, 1.1fr) auto auto minmax(250px, 1.6fr);
  gap: 10px;
  align-items: stretch;
}
.d2-shell .cc-strip-metrics > * {
  background: #ffffff;
  border: 1px solid rgba(18, 22, 36, 0.06);
  border-radius: 10px;
  padding: 11px 14px;
  min-width: 0;
}
.d2-shell .cc-severity {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--sb-blue-strong, #1859e6);
}
.d2-shell .cc-severity > div:nth-child(2) {
  display: grid;
  gap: 2px;
  flex: 1;
}
.d2-shell .cc-severity strong {
  font-size: 13px;
  color: var(--sb-ink, #121624);
}
.d2-shell .cc-severity span {
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-severity-1,
.d2-shell .cc-severity-2 {
  color: var(--sb-amber-strong, #e88a00);
}
.d2-shell .cc-severity-3,
.d2-shell .cc-severity-4 {
  color: var(--sb-red, #e5484d);
}
.d2-shell .cc-severity-scale {
  display: flex;
  gap: 3px;
}
.d2-shell .cc-severity-scale i {
  width: 6px;
  height: 18px;
  border-radius: 3px;
  background: rgba(18, 22, 36, 0.09);
}
.d2-shell .cc-severity-scale i.filled {
  background: currentColor;
}
.d2-shell .cc-count {
  display: grid;
  align-content: center;
  gap: 2px;
  text-align: center;
  min-width: 96px;
}
.d2-shell .cc-count strong {
  font-size: 22px;
  font-weight: 650;
  color: var(--sb-ink, #121624);
  font-variant-numeric: tabular-nums;
}
.d2-shell .cc-count span {
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-ops {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  align-items: center;
}
.d2-shell .cc-ops-score {
  display: flex;
  align-items: center;
  gap: 10px;
  grid-row: span 2;
}
.d2-shell .cc-ops-score strong {
  font-size: 22px;
  font-weight: 650;
  color: var(--sb-blue-strong, #1859e6);
}
.d2-shell .cc-ops-score span {
  display: grid;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-ops-score small {
  letter-spacing: 0;
  font-size: 10.5px;
  color: var(--sb-ink-2, #343a4c);
}
.d2-shell .cc-ops-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 10.5px;
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-ops-counts span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.d2-shell .hv-health-banner .cc-ops-counts b {
  font-size: 11px;
  color: var(--sb-ink, #121624);
}
.d2-shell .cc-snapshot {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: var(--sb-faint, #a2a8b6);
}

/* ---------- building overview ---------- */
.d2-shell .cc-overview .hv-section-heading {
  align-items: flex-start;
}
.d2-shell .cc-systems {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
  margin: 14px 0;
}
.d2-shell .cc-system {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid rgba(18, 22, 36, 0.06);
  color: var(--sb-blue, #2f7bff);
}
.d2-shell .cc-system code {
  flex: 1;
}
.d2-shell .cc-system.affected {
  color: var(--sb-amber-strong, #e88a00);
  border-color: #ffe0a8;
}
.d2-shell .cc-system.unavailable {
  color: var(--sb-red, #e5484d);
  border-color: #ffd0cd;
  background: rgba(255, 244, 243, 0.8);
}
.d2-shell .cc-system.rerouted {
  color: #1d7a45;
  border-color: #bfe6cd;
}
.d2-shell .cc-system.unmonitored {
  color: var(--sb-faint, #a2a8b6);
  opacity: 0.75;
}
.d2-shell .cc-sequence {
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
  background: linear-gradient(170deg, rgba(255, 248, 236, 0.9), rgba(255, 255, 255, 0.6));
  border: 1px solid #ffe0a8;
}
.d2-shell .cc-sequence.approved {
  background: linear-gradient(170deg, rgba(236, 248, 241, 0.9), rgba(255, 255, 255, 0.6));
  border-color: #bfe6cd;
}
.d2-shell .cc-sequence-heading {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  margin-bottom: 10px;
  color: var(--sb-ink, #121624);
}
.d2-shell .cc-sequence-heading span {
  font-size: 10.5px;
  color: var(--sb-amber-deep, #8f4f00);
}
.d2-shell .cc-sequence.approved .cc-sequence-heading span {
  color: #1d7a45;
}
.d2-shell .cc-sequence ol {
  display: grid;
  gap: 6px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.d2-shell .cc-sequence li {
  display: flex;
  gap: 9px;
  align-items: baseline;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--sb-ink-2, #343a4c);
  animation: cc-rise 0.4s var(--sb-out, ease-out) both;
}
.d2-shell .cc-sequence li:nth-child(2) { animation-delay: 0.08s; }
.d2-shell .cc-sequence li:nth-child(3) { animation-delay: 0.16s; }
.d2-shell .cc-sequence li:nth-child(4) { animation-delay: 0.24s; }
.d2-shell .cc-sequence li:nth-child(5) { animation-delay: 0.32s; }
.d2-shell .cc-sequence li > span {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: none;
  font-size: 10px;
  font-weight: 650;
  background: #fff;
  border: 1px solid #ffd58a;
  color: var(--sb-amber-deep, #8f4f00);
}
.d2-shell .cc-sequence.approved li > span {
  border-color: #9fd8b4;
  color: #1d7a45;
}

/* ---------- incident command ---------- */
.d2-shell .cc-command {
  display: grid;
  gap: 16px;
}
.d2-shell .cc-command .hv-section-heading {
  margin-bottom: 0;
}
.d2-shell .cc-incident-title {
  display: flex;
  gap: 12px;
  align-items: center;
}
.d2-shell .cc-incident-title p {
  font-size: 12px;
  color: var(--sb-ink-2, #343a4c);
}
.d2-shell .cc-tile {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  flex: none;
  color: #fff;
  background: linear-gradient(150deg, var(--sb-amber-hi, #ffc75a), var(--sb-amber-strong, #e88a00));
}
.d2-shell .cc-tile.fire {
  background: linear-gradient(150deg, #ff8a7a, var(--sb-red, #e5484d));
  box-shadow: 0 1px 2px rgba(229, 72, 77, 0.25);
}
.d2-shell .cc-tile.leak {
  background: linear-gradient(150deg, var(--sb-blue-hi, #6aa6ff), var(--sb-blue-strong, #1859e6));
  box-shadow: 0 1px 2px rgba(47, 123, 255, 0.25);
}
.d2-shell .cc-tile.ok {
  background: linear-gradient(150deg, #6fd39a, #1d7a45);
}
.d2-shell .cc-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 5px;
  font-size: 10.5px;
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.d2-shell .cc-impact,
.d2-shell .cc-plan,
.d2-shell .cc-dispatch {
  border-top: 1px solid rgba(18, 22, 36, 0.07);
  padding-top: 14px;
}
.d2-shell .cc-impact ol {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}
.d2-shell .cc-impact li {
  position: relative;
  display: grid;
  grid-template-columns: 62px 1fr auto;
  gap: 2px 10px;
  align-items: center;
  padding: 9px 12px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid rgba(18, 22, 36, 0.06);
}
.d2-shell .cc-impact li strong {
  font-size: 12px;
  color: var(--sb-ink, #121624);
}
.d2-shell .cc-impact li small {
  grid-column: 2;
  font-size: 10.5px;
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-impact li .cc-chip {
  grid-column: 3;
  grid-row: 1 / span 2;
}
.d2-shell .cc-impact li > svg {
  display: none;
}
.d2-shell .cc-impact > small {
  display: block;
  margin-top: 8px;
  font-size: 10px;
  color: var(--sb-faint, #a2a8b6);
}
.d2-shell .cc-plan-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 100px;
  font-size: 10.5px;
  font-weight: 600;
  background: var(--sb-amber-soft, #fff2d9);
  color: var(--sb-amber-deep, #8f4f00);
}
.d2-shell .cc-plan-status.approved {
  background: #e6f6ec;
  color: #1d7a45;
}
.d2-shell .cc-plan-intro {
  font-size: 11px;
  color: var(--sb-muted, #707789);
  margin-bottom: 10px;
}
.d2-shell .cc-steps {
  list-style: none;
  padding: 0;
  margin: 0 0 10px;
  display: grid;
  gap: 8px;
}
.d2-shell .cc-steps li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.d2-shell .cc-steps li > span {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: none;
  font-size: 11px;
  font-weight: 650;
  background: var(--sb-blue-soft, #e8f0ff);
  color: var(--sb-blue-strong, #1859e6);
}
.d2-shell .cc-steps li p {
  font-size: 12px;
  line-height: 1.55;
  color: var(--sb-ink-2, #343a4c);
}
.d2-shell .cc-rationale {
  margin-bottom: 12px;
}
.d2-shell .cc-rationale summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--sb-blue-strong, #1859e6);
}
.d2-shell .cc-rationale summary::-webkit-details-marker {
  display: none;
}
.d2-shell .cc-rationale[open] summary svg:last-child {
  transform: rotate(90deg);
}
.d2-shell .cc-rationale p {
  margin-top: 8px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--sb-ink-2, #343a4c);
}
.d2-shell .cc-approval {
  border-radius: 10px;
  padding: 13px 14px;
  display: grid;
  gap: 9px;
  background: linear-gradient(170deg, rgba(255, 248, 236, 0.95), rgba(255, 255, 255, 0.65));
  border: 1px solid #ffe0a8;
}
.d2-shell .cc-approval.confirmed {
  background: linear-gradient(170deg, rgba(236, 248, 241, 0.95), rgba(255, 255, 255, 0.65));
  border-color: #bfe6cd;
}
.d2-shell .cc-approval-title {
  display: flex;
  gap: 10px;
  align-items: center;
}
.d2-shell .cc-approval-title > span {
  color: var(--sb-amber-strong, #e88a00);
}
.d2-shell .cc-approval.confirmed .cc-approval-title > span {
  color: #1d7a45;
}
.d2-shell .cc-approval-title strong {
  font-size: 12.5px;
  color: var(--sb-ink, #121624);
}
.d2-shell .cc-approval-title p {
  font-size: 10.5px;
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-publication,
.d2-shell .cc-instruction {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--sb-ink-2, #343a4c);
}
.d2-shell .cc-publication svg,
.d2-shell .cc-instruction svg {
  flex: none;
  margin-top: 2px;
}
.d2-shell .cc-approve {
  margin-top: 12px;
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 100px;
  border: 0;
  font-size: 13px;
  font-weight: 650;
  color: #fff;
  cursor: pointer;
  background: linear-gradient(150deg, var(--sb-blue-hi, #6aa6ff), var(--sb-blue-strong, #1859e6));
  box-shadow: 0 1px 2px rgba(47, 123, 255, 0.25);
  transition: transform 0.2s var(--sb-out, ease-out), box-shadow 0.2s;
}
.d2-shell .cc-approve:hover:not(:disabled) {
  transform: translateY(-1px);
}
.d2-shell .cc-approve.is-approved,
.d2-shell .cc-approve:disabled {
  cursor: default;
}
.d2-shell .cc-approve.is-approved {
  background: linear-gradient(150deg, #6fd39a, #1d7a45);
  box-shadow: none;
}
.d2-shell .cc-hint,
.d2-shell .cc-note {
  margin-top: 8px;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-emergency {
  margin-top: 10px;
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 16px;
  border-radius: 100px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  background: #fff;
  color: #b4232a;
  border: 1.5px solid #ffb9b4;
}
.d2-shell .cc-emergency:hover:not(:disabled) {
  background: var(--sb-red-soft, #ffeceb);
}
.d2-shell .cc-emergency:disabled {
  cursor: default;
  color: var(--sb-muted, #707789);
  border-color: rgba(18, 22, 36, 0.1);
}
.d2-shell .cc-call {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}
.d2-shell .cc-call > strong {
  font-size: 11px;
  color: var(--sb-ink-2, #343a4c);
}
.d2-shell .cc-call ol {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}
.d2-shell .cc-call li {
  padding: 9px 11px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid rgba(18, 22, 36, 0.06);
  animation: cc-rise 0.45s var(--sb-out, ease-out) both;
}
.d2-shell .cc-call li b {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--sb-blue-strong, #1859e6);
}
.d2-shell .cc-call li p,
.d2-shell .cc-report {
  font-size: 11px;
  line-height: 1.55;
  color: var(--sb-ink-2, #343a4c);
}
.d2-shell .cc-report {
  padding: 9px 11px;
  border-radius: 12px;
  background: var(--sb-amber-soft, #fff2d9);
}
.d2-shell .cc-daily {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.d2-shell .cc-daily h3 {
  font-size: 13px;
  font-weight: 650;
  color: var(--sb-ink, #121624);
}
.d2-shell .cc-daily p {
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--sb-muted, #707789);
  margin-top: 3px;
}
.d2-shell .cc-command .hv-incidents {
  border-top: 1px solid rgba(18, 22, 36, 0.07);
  padding-top: 14px;
}

/* ---------- response coordination ---------- */
.d2-shell .cc-coordination {
  padding: 22px;
  border-radius: 12px;
}
.d2-shell .cc-teams {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.d2-shell .cc-teams article {
  display: flex;
  gap: 10px;
  padding: 14px;
  border-radius: 10px;
  background: #ffffff;
  border: 1px solid rgba(18, 22, 36, 0.06);
  color: var(--sb-blue, #2f7bff);
}
.d2-shell .cc-teams article > div {
  display: grid;
  gap: 6px;
  justify-items: start;
  min-width: 0;
}
.d2-shell .cc-teams strong {
  font-size: 12.5px;
  color: var(--sb-ink, #121624);
}
.d2-shell .cc-teams small {
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--sb-muted, #707789);
}
.d2-shell .cc-teams button {
  margin-top: 2px;
  padding: 7px 12px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  background: #fff;
  color: var(--sb-blue-strong, #1859e6);
  border: 1px solid rgba(47, 123, 255, 0.28);
}
.d2-shell .cc-teams button:hover:not(:disabled) {
  background: var(--sb-blue-soft, #e8f0ff);
}

/* ---------- motion ---------- */
@keyframes cc-pulse {
  50% {
    transform: scale(1.06);
    box-shadow: 0 0 0 8px rgba(229, 72, 77, 0.12);
  }
}
@keyframes cc-blink {
  50% {
    opacity: 0.3;
  }
}
@keyframes cc-rise {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .d2-shell .cc-orb.alert,
  .d2-shell .cc-badge.red i,
  .d2-shell .cc-sequence li,
  .d2-shell .cc-call li {
    animation: none;
  }
}

/* ---------- responsive ---------- */
@media (max-width: 1100px) {
  .d2-shell .cc-strip-metrics {
    grid-template-columns: 1fr 1fr;
  }
  .d2-shell .cc-teams {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .d2-shell .cc-strip-metrics {
    grid-template-columns: 1fr;
  }
  .d2-shell .cc-strip-main {
    flex-wrap: wrap;
  }
  .d2-shell .cc-impact li {
    grid-template-columns: 1fr auto;
  }
  .d2-shell .cc-impact li code {
    grid-column: 1 / -1;
  }
  .d2-shell .cc-impact li small {
    grid-column: 1;
  }
  .d2-shell .cc-impact li .cc-chip {
    grid-column: 2;
  }
}
