# THRESH Scholastic Youth Privacy & Safe Sport Compliance Framework

**Version:** 2.1 (Scholastic Release)  
**Applicability:** High School, Middle School, Junior Development Clubs, and Collegiate Programs  
**Statutory Scope:** COPPA (15 U.S.C. §§ 6501–6506), FERPA (34 CFR Part 99), Protecting Young Victims from Sexual Abuse and Safe Sport Authorization Act of 2017 (36 U.S.C. §§ 220541–220543), California Age-Appropriate Design Code Act (AB 2273).

---

## 1. Architectural Safeguards for Minor Athletes (< 18)

### Closed-Roster Onboarding Gate
1. **No Standalone Minor Registration:**
   - Minor student-athletes cannot create standalone unmanaged accounts in THRESH.
   - Any athlete indicating age < 18 or birth year within 18 years of current calendar year must join through a certified school or club athletic team via a 6-character Join Code or coach roster invite.
2. **Coach-Initiated Roster Import:**
   - Head coaches create the team container (`HIGH_SCHOOL` or `COACH_SQUAD`) and upload roster information (First Name, Last Name, Athlete Email, Squad Pod, Parent/Guardian Email, Graduation/Birth Year).
   - The team serves as the protective legal boundary under school athletic sponsorship.

---

## 2. Children's Online Privacy Protection Act (COPPA) Compliance

### Verifiable Parent / Guardian Acknowledgment
1. **Notice at Enrollment:**
   - When a student-athlete claims their roster spot, THRESH collects or confirms `parentGuardianEmail`.
   - An automated, branded notification is dispatched to the parent/guardian via Resend containing:
     - Identity of the coach and school athletic team.
     - Description of athletic telemetry collected (GPS coordinates, heart rate, pacing, power, cadence).
     - Explicit disclosure that biometrics are shielded (Safe-Sport Weight Shield active).
     - 1-click Acknowledgment link (`/api/teams/parent-consent?token=...`).
2. **Consent State Tracking:**
   - `parentConsentStatus`: `PENDING` | `ACKNOWLEDGED` | `NOT_REQUIRED` (adult athletes).
   - Timestamp and verified token logged in encrypted tenant vault (`parentConsentAt`).

---

## 3. Safe Sport & RED-S Eating Disorder Protection

### Weight & W/kg Shielding
1. **Automatic Enforcement:**
   - All `HIGH_SCHOOL` rosters and athletes flagged `isMinorU18: true` have `safeSportHideWeight` enforced on server-side and client-side views.
2. **Data Obfuscation:**
   - Body weight (`kg` / `lbs`) and power-to-weight ratio (`W/kg`) are concealed from fellow teammates, public leaderboards, and coach roster cards.
   - Absolute power (`Watts`), pace (`min/mi` or `min/km`), heart rate zones, and CTL/ATL load models remain calibrated underneath without triggering weight scrutiny or disordered eating triggers.

---

## 4. Family Educational Rights and Privacy Act (FERPA) Alignment

1. **School Official Exception:**
   - THRESH functions as a school official / athletic vendor with legitimate educational interest in tracking student-athlete conditioning, academic stress balance, and injury risk prevention.
2. **Zero Commercial Exploitation:**
   - **Zero Advertising:** THRESH serves zero third-party ads.
   - **Zero Data Broker Sales:** Student-athlete biometrics, GPS paths, and wellness survey responses are never monetized, rented, or transferred to third-party data brokers.
   - **Local-First Clean-Room Firewall:** Telemetry stays within the tenant vault and browser Dexie storage. Fellow teammates only see squad names and sanitized activity summaries.

---

## 5. Scholastic Data Retention & Parental Rights

1. **Parental Inspection:**
   - Parents retain the legal right to review their child's training records upon request to the head coach or support team (`support@thresh.app`).
2. **Deletion & Data Portability:**
   - Upon graduation or athlete request, student-athletes or parents may export their entire workout history via JSON/CSV/FIT and request permanent deletion from school team tenant vaults.
3. **Audit Trail:**
   - NCAA CARA (Countable Athletically Related Activities) 20-hour weekly and 4-hour daily limits are audited in real time to prevent overtraining and athletic exploitation.
