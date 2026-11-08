# AeroPulse — Exercise Physiology & Mathematical Telemetry Reference

This document specifies the exact mathematical formulations, physiological time constants, zone boundaries, and algorithmic classifiers implemented across AeroPulse's client and Web Worker engines (`src/components/charts/EChartsPMCDashboard.tsx`, `src/utils/telemetryStorage.ts`, and `src/workers/`).

---

## 1. Banister Impulse-Response Model (`CTL`, `ATL`, `TSB`, `Ramp Rate`, `ACWR`)

AeroPulse models chronic adaptation and acute fatigue using the Banister exponentially weighted moving average (EWMA) impulse-response equations.

### 1.1 Chronic Training Load (`CTL` — Fitness)
`CTL` uses a 42-day decay time constant ($\tau_{\text{CTL}} = 42\text{ days}$) to quantify long-term aerobic base and structural durability:

$$\text{CTL}_t = \text{CTL}_{t-1} + \frac{\text{TSS}_t - \text{CTL}_{t-1}}{42} = \text{CTL}_{t-1} \cdot e^{-1/42} + \text{TSS}_t \cdot \left(1 - e^{-1/42}\right)$$

### 1.2 Acute Training Load (`ATL` — Fatigue)
`ATL` uses a 7-day decay time constant ($\tau_{\text{ATL}} = 7\text{ days}$) to quantify immediate neuromuscular and autonomic fatigue:

$$\text{ATL}_t = \text{ATL}_{t-1} + \frac{\text{TSS}_t - \text{ATL}_{t-1}}{7} = \text{ATL}_{t-1} \cdot e^{-1/7} + \text{TSS}_t \cdot \left(1 - e^{-1/7}\right)$$

### 1.3 Training Stress Balance (`TSB` — Form)
`TSB` represents net readiness resulting from the difference between Chronic Fitness and Acute Fatigue:

$$\text{TSB}_t = \text{CTL}_t - \text{ATL}_t$$

| Form Zone (`TSB`) | Numerical Range | Color Token | Physiological Interpretation |
| :--- | :---: | :---: | :--- |
| **Transition / Detraining** | $> +25$ | `#f59e0b` (Amber) | Extended recovery or off-season transition; aerobic fitness begins to decay. |
| **Fresh / Race Ready** | $+5 \text{ to } +25$ | `#38bdf8` (Sky Blue) | Optimal taper corridor where `ATL` has shed while `CTL` remains near peak. |
| **Grey Zone (Neutral)** | $-10 \text{ to } +5$ | `#94a3b8` (Slate) | Maintenance load or transition between recovery and build microcycles. |
| **Optimal Training** | $-25 \text{ to } -10$ | `#10b981` (Emerald) | Productive overload zone driving mitochondrial and capillary biogenesis. |
| **High Risk / Overreaching** | $< -30$ | `#f43f5e` (Rose Red) | High acute strain; elevated risk of non-functional overreaching or injury. |

### 1.4 Weekly `CTL` Ramp Rate & Acute-to-Chronic Workload Ratio (`ACWR`)

$$\text{Ramp Rate}_t = \text{CTL}_t - \text{CTL}_{t-7} \quad (\text{CTL/week})$$

$$\text{ACWR}_t = \frac{\text{ATL}_t}{\max(1, \text{CTL}_t)}$$

- **Optimal Build Ramp Rate**: $+3.0 \text{ to } +5.5\text{ CTL/wk}$.
- **Overreach Caution Threshold**: $> +7.0\text{ CTL/wk}$ or $\text{ACWR} > 1.35$.

---

## 2. Daily Stacked Garmin Training Load Focus Classifier

In `EChartsPMCDashboard.tsx` (`classifyActivityGarminLoad` and `buildDayLoadSegments`), AeroPulse classifies every individual workout into Garmin's three **Training Load Focus** pathways and stacks multiple same-day sessions chronologically (`AM` at the bottom of the bar → `PM` at the top).

### 2.1 Color & Pathway Definitions

| Garmin Load Focus | Hex Color | Target Zones | Physiological Pathway |
| :--- | :---: | :---: | :--- |
| **Low Aerobic** | `#38bdf8` (Cyan) | `Z1` – `Z2` | Aerobic base, peripheral capillarization, lipid oxidation, parasympathetic recovery, warmups & cooldowns. |
| **High Aerobic** | `#f97316` (Orange) | `Z3` – `Z4` | Tempo, Sweet Spot (`88–94% FTP`), Lactate Threshold (`LT2`), fractional utilization of $\text{VO}_2\max$. |
| **Anaerobic** | `#d946ef` (Magenta) | `Z5` – `Z7` | $\text{VO}_2\max$ intervals, anaerobic glycolysis (`W'` depletion), neuromuscular sprints, track repeats (`200m`–`800m`), crits/Zwift races. |

### 2.2 Multi-Tier Decision Hierarchy (`classifyActivityGarminLoad`)
1. **Explicit Recovery / Base / Warmup / Cooldown Semantics**:
   - Workouts titled `Warmup`, `Cooldown`, `Recovery`, `Shakeout`, `Easy`, `Z1`, `Z2`, `Base`, or short spins ($\text{TSS} \le 14$ and duration $\le 30\text{ min}$) without high-intensity keywords classify as **Low Aerobic (`#38bdf8`)**.
2. **Explicit Anaerobic / VO2max / Track / Race Semantics**:
   - Workouts matching `Anaerobic`, `Sprint`, `Track`, `Crit`, `Zwift Race`, `VO2max`, `Microburst`, `30/30`, `40/20`, `200m`, `400m`, `800m` classify as **Anaerobic (`#d946ef`)**.
3. **Explicit High Aerobic (Tempo / Sweet Spot / Threshold) Semantics**:
   - Workouts matching `Tempo`, `Sweet Spot`, `SST`, `Threshold`, `LT1`, `LT2`, `Cruise`, `Over-Under`, `Time Trial`, `Marathon Pace` classify as **High Aerobic (`#f97316`)**.
4. **7-Zone Time-in-Zone Inspection (`zoneSecs.power`, `zoneSecs.pace`, `zoneSecs.hr`)**:
   - Let $T_{\text{total}} = \sum_{i=1}^7 t_{Z_i}$, $T_{Z3,Z4} = t_{Z3} + t_{Z4}$, $T_{Z5+} = t_{Z5} + t_{Z6} + t_{Z7}$, and $T_{Z6,Z7} = t_{Z6} + t_{Z7}$:
   - **Anaerobic** if:
     $$\frac{T_{Z6,Z7}}{T_{\text{total}}} \ge 0.05 \quad \text{or} \quad \frac{T_{Z5+}}{T_{\text{total}}} \ge 0.14 \quad \text{or} \quad \left(\frac{T_{Z5+}}{T_{\text{total}}} \ge 0.09 \text{ and } T_{Z5+} \ge 0.7 \cdot T_{Z3,Z4}\right)$$
   - **High Aerobic** if:
     $$\frac{T_{Z3,Z4} + T_{Z5+}}{T_{\text{total}}} \ge 0.30 \quad \text{or} \quad \frac{T_{Z3,Z4}}{T_{\text{total}}} \ge 0.25$$
   - Otherwise **Low Aerobic**.
5. **Intensity Factor (`IF`), Variability Index (`VI`), and LTHR Fallback**:
   - **Anaerobic** if $\text{IF} \ge 0.95$, or $(\text{IF} \ge 0.85 \text{ and } \text{VI} \ge 1.13)$, or $\text{HR}_{\text{avg}} \ge 0.96 \cdot \text{LTHR}$.
   - **High Aerobic** if $0.80 \le \text{IF} < 0.95$ or $\text{HR}_{\text{avg}} \ge 0.88 \cdot \text{LTHR}$.
   - **Low Aerobic** otherwise.

---

## 3. Coggan Power & Pace Stress Metrics (`NP`, `IF`, `VI`, `TSS`)

### 3.1 Normalized Power (`NP`)
Given a 1Hz power stream $P(t)$, AeroPulse computes a 30-second rolling average $P_{30\text{s}}(t)$ and raises each sample to the 4th power (mirroring blood lactate accumulation relative to metabolic threshold):

$$P_{30\text{s}}(t) = \frac{1}{30} \sum_{k=t-29}^{t} P(k)$$

$$\text{NP} = \left( \frac{1}{N} \sum_{t=30}^{N} \left[ P_{30\text{s}}(t) \right]^4 \right)^{1/4}$$

### 3.2 Intensity Factor (`IF`) & Variability Index (`VI`)
AeroPulse dynamically selects either your **Outdoor FTP** or **Indoor / Smart-Trainer FTP** based on `activity.environment`:

$$\text{IF} = \frac{\text{NP}}{\text{FTP}_{\text{env}}}, \qquad \text{VI} = \frac{\text{NP}}{P_{\text{avg}}}$$

- Steady time trials and erg-mode trainer blocks yield $\text{VI} \approx 1.00 - 1.03$.
- Surgy criteriums, group rides, and hilly trail runs yield $\text{VI} \ge 1.10$.

### 3.3 Training Stress Score (`TSS`)

$$\text{TSS} = \frac{T_{\text{secs}} \cdot \text{NP} \cdot \text{IF}}{\text{FTP}_{\text{env}} \cdot 3600} \times 100 = \left(\frac{T_{\text{secs}}}{3600}\right) \cdot \text{IF}^2 \times 100$$

For running sessions without power, **running TSS (`rTSS`)** or **heart-rate TSS (`hrTSS`)** is computed from Grade Adjusted Pace (`GAP`) relative to **Threshold Pace (`s/km`)** or Friel LTHR zones.

---

## 4. Efficiency Factor (`EF`) & Aerobic Decoupling (`Pa:Hr` / `Pw:Hr`)

Aerobic Decoupling quantifies cardiovascular drift over the course of a workout by comparing the ratio of output (Normalized Power or Grade Adjusted Speed) to Heart Rate between the first half ($H_1$) and second half ($H_2$) of moving time:

$$\text{EF}_{H_1} = \frac{\text{NP}_{H_1}}{\text{HR}_{\text{avg}, H_1}}, \qquad \text{EF}_{H_2} = \frac{\text{NP}_{H_2}}{\text{HR}_{\text{avg}, H_2}}$$

$$\text{Decoupling (Pa:Hr \%)} = \left( \frac{\text{EF}_{H_1} - \text{EF}_{H_2}}{\text{EF}_{H_1}} \right) \times 100\%$$

- **$< 3.5\%$ (Durable / Coupled)**: Strong aerobic durability and stroke-volume stability at that intensity.
- **$3.5\% \text{ to } 5.0\%$ (Moderate Drift)**: Approaching the upper boundary of current endurance base.
- **$> 5.0\%$ (Significant Cardiac Drift)**: Thermal strain, dehydration, glycogen depletion, or insufficient mitochondrial base for the duration.

---

## 5. Monod-Scherrer Critical Power (`CP`), `W'` & Skiba 1Hz `W'` Balance

### 5.1 Two-Parameter Hyperbolic Power-Duration Model
For severe-domain efforts between $2\text{ minutes}$ and $30\text{ minutes}$, total work $W(t)$ is linear with duration $t$:

$$W(t) = \text{CP} \cdot t + W' \quad \Longleftrightarrow \quad P(t) = \text{CP} + \frac{W'}{t}$$

- **$\text{CP}$ (Critical Power, Watts)**: The asymptotic power output sustainable without progressive depletion of anaerobic energy reserves.
- **$W'$ (Anaerobic Work Capacity, Joules / kJ)**: The finite supra-threshold energy battery available above $\text{CP}$ (typically $14\text{ kJ}$ to $28\text{ kJ}$).

### 5.2 Skiba Differential / Integral 1Hz $W'_{\text{bal}}(t)$
During 1Hz stream inspection, AeroPulse tracks real-time anaerobic battery depletion when $P(t) > \text{CP}$ and exponential reconstitution when $P(t) < \text{CP}$:

$$W'_{\text{bal}}(t) = \begin{cases} W'_{\text{bal}}(t-1) - \left(P(t) - \text{CP}\right) & \text{if } P(t) > \text{CP} \\[6pt] W' - \left(W' - W'_{\text{bal}}(t-1)\right) \cdot e^{-1 / \tau_{W'}} & \text{if } P(t) \le \text{CP} \end{cases}$$

where the recovery time constant $\tau_{W'}$ depends on how far below $\text{CP}$ the athlete recovers ($D_{\text{CP}} = \text{CP} - P_{\text{rec}}$):

$$\tau_{W'} = 546 \cdot e^{-0.01 \cdot D_{\text{CP}}} + 316 \quad (\text{seconds})$$

---

## 6. Daniels `VDOT` & Riegel Race Time Equivalency

### 6.1 Daniels Oxygen Cost & Fractional Utilization (`VDOT`)
Given a race distance $D$ (meters) and official Fully Automatic Timing mark $T$ (minutes), running velocity is $v = D / T\text{ (m/min)}$. The oxygen cost $\text{VO}_2(v)$ and sustainable fraction $\% \text{VO}_2\max(T)$ are:

$$\text{VO}_2(v) = -4.60 + 0.182258 \cdot v + 0.000104 \cdot v^2$$

$$\% \text{VO}_2\max(T) = 0.8 + 0.1894393 \cdot e^{-0.012778 \cdot T} + 0.2989558 \cdot e^{-0.1932605 \cdot T}$$

$$\text{VDOT} = \frac{\text{VO}_2(v)}{\% \text{VO}_2\max(T)}$$

### 6.2 Riegel Fatigue-Factor Race Predictor
For cross-distance race projections (`800m` up to `Marathon`), AeroPulse blends Daniels `VDOT` tables with Riegel's power-law endurance scaling:

$$T_2 = T_1 \cdot \left( \frac{D_2}{D_1} \right)^{1.06}$$

---

## 7. Autonomic Readiness: `HRV rMSSD`, 60-Day Corridor & 7-Day `HRV CV%`

### 7.1 Rolling 7-Day Mean & Coefficient of Variation (`CV%`)
Given daily morning vagal Heart Rate Variability samples $x_i = \text{rMSSD}_i\text{ (ms)}$ over the trailing 7 days:

$$\mu_{7\text{d}} = \frac{1}{7} \sum_{i=t-6}^{t} x_i, \qquad \sigma_{7\text{d}} = \sqrt{\frac{1}{7} \sum_{i=t-6}^{t} \left(x_i - \mu_{7\text{d}}\right)^2}$$

$$\text{HRV CV}_{7\text{d}}(\%) = \left( \frac{\sigma_{7\text{d}}}{\mu_{7\text{d}}} \right) \times 100\%$$

### 7.2 Closed-Loop Daily Readiness Morphing Rules
AeroPulse's **Readiness Morphing Engine** combines morning `HRV rMSSD` vs. the 60-day normal band $[\text{Band}_{\text{low}}, \text{Band}_{\text{high}}]$, `HRV CV%`, `Resting HR` delta, `Sleep Score`, and `TSB`:
1. **`OPTIMAL` (Green)**: $\text{rMSSD}_t \ge \text{Band}_{\text{low}}$, $\text{TSB}_t \ge -22$, and $\text{Sleep Score} \ge 72$ → Execute full planned `Z4`/`Z5` prescription.
2. **`MODULATED` (Amber — `-15% Load`)**: Mild autonomic dip ($\text{rMSSD}_t$ near lower band boundary or $-30 \le \text{TSB}_t < -22$) → Downshifts `VO2max` / `Threshold` intervals to controlled `Sweet Spot` / `Tempo` (`85–90% FTP`).
3. **`RECOVERY` (Rose — Active Flush)**: Significant vagal suppression ($\text{rMSSD}_t < \text{Band}_{\text{low}}$, $\text{HRV CV}_{7\text{d}} > 8.5\%$, or $\text{TSB}_t < -30$) → Replaces high-intensity work with a $45\text{ min}$ `Z1`/`Z2` (`55–62% FTP`) parasympathetic recovery spin/jog.
