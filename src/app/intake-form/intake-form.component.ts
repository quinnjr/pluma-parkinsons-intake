import { CommonModule } from '@angular/common';
import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { AuthService } from '../shared/auth.service';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faArrowLeft,
  faArrowRight,
  faBiohazard,
  faBrain,
  faCheck,
  faCircleInfo,
  faClipboardList,
  faDna,
  faFlask,
  faHeartPulse,
  faIndustry,
  faLeaf,
  faLocationDot,
  faPersonWalking,
  faShieldHalved,
  faTint,
  faTriangleExclamation,
  faUser,
} from '../icons';
import { EMPTY_INTAKE, EnvironmentalExposure, IntakeForm, IntakePayload } from '../risk/risk.model';
import { IntakePayloadService } from '../risk/risk.service';
import { SuperfundService, type SuperfundStateInfo } from '../shared/superfund.service';
import { StateResidencyComponent } from './state-residency/state-residency.component';
import { SubmissionReviewComponent } from '../submission-review/submission-review.component';

type StepKey = 'contact' | 'demographics' | 'environmental' | 'lifestyle' | 'motor' | 'nonMotor' | 'review';

interface StepDef {
  key: StepKey;
  title: string;
  subtitle: string;
  icon: IconDefinition;
}

interface Option<V extends string = string> {
  v: V;
  l: string;
}

const YES_NO_UNKNOWN: readonly Option[] = [
  { v: 'yes', l: 'Yes' },
  { v: 'no', l: 'No' },
  { v: 'unknown', l: 'Not sure' },
];

const YES_NO_SHORT: readonly Option[] = [
  { v: 'yes', l: 'Yes' },
  { v: 'no', l: 'No' },
  { v: 'unknown', l: '?' },
];

const SEVERITY_OPTS: readonly Option[] = [
  { v: 'none', l: 'None' },
  { v: 'mild', l: 'Mild' },
  { v: 'moderate', l: 'Moderate' },
  { v: 'severe', l: 'Severe' },
];

const SEVERITY_OPTS_SHORT: readonly Option[] = [
  { v: 'none', l: 'None' },
  { v: 'mild', l: 'Mild' },
  { v: 'moderate', l: 'Mod.' },
  { v: 'severe', l: 'Severe' },
];

const FREQUENCY_OPTS: readonly Option[] = [
  { v: 'never', l: 'Never' },
  { v: 'rare', l: 'Rarely' },
  { v: 'occasional', l: 'Occasionally' },
  { v: 'frequent', l: 'Frequently' },
  { v: 'daily', l: 'Daily' },
];

const RBD_FREQUENCY_OPTS: readonly Option[] = [
  { v: 'never', l: 'Never' },
  { v: 'rare', l: 'Rarely' },
  { v: 'occasional', l: 'Occasionally' },
  { v: 'frequent', l: 'Frequently' },
  { v: 'daily', l: 'Nearly nightly' },
];

const AGE_BANDS: readonly string[] = ['<40', '40-49', '50-59', '60-69', '70-79', '80+'];

const SEX_OPTS: readonly Option[] = [
  { v: 'male', l: 'Male' },
  { v: 'female', l: 'Female' },
  { v: 'intersex', l: 'Intersex' },
  { v: 'prefer-not', l: 'Prefer not to say' },
];

const SMOKING_OPTS: readonly Option[] = [
  { v: 'never', l: 'Never' },
  { v: 'former', l: 'Former' },
  { v: 'current', l: 'Current' },
];

const CAFFEINE_OPTS: readonly Option[] = [
  { v: 'none', l: 'None' },
  { v: 'light', l: '1 cup' },
  { v: 'moderate', l: '2\u20133 cups' },
  { v: 'heavy', l: '4+ cups' },
];

const SUPERFUND_OPTS: readonly Option[] = [
  { v: 'none', l: 'None / never' },
  { v: 'under-1mi', l: 'Within 1 mile' },
  { v: '1-5mi', l: '1\u20135 miles' },
  { v: '5-10mi', l: '5\u201310 miles' },
  { v: 'unknown', l: 'Not sure' },
];

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
  AS: 'American Samoa', MP: 'Northern Mariana Islands',
};

@Component({
  selector: 'app-intake-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, FaIconComponent, StateResidencyComponent, SubmissionReviewComponent],
  templateUrl: './intake-form.component.html',
})
export class IntakeFormComponent {
  private payloads = inject(IntakePayloadService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private superfund = inject(SuperfundService);

  superfundStates = signal<SuperfundStateInfo[]>([]);

  readonly authReady = this.auth.ready;
  readonly currentUser = this.auth.user;
  readonly canFillForm = computed(() => {
    const u = this.currentUser();
    return u != null && u.confirmed && u.role === 'patient';
  });
  readonly isSignedInNonPatient = computed(() => {
    const u = this.currentUser();
    return u != null && u.role !== 'patient';
  });

  constructor() {
    afterNextRender(() => {
      if (!this.auth.ready()) void this.auth.loadMe();
    });
    afterNextRender(async () => {
      await this.superfund.loadStates();
      this.superfundStates.set(this.superfund.states() ?? []);
    });
  }

  async signOut(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/admin/login']);
  }

  readonly icons = {
    back: faArrowLeft,
    next: faArrowRight,
    check: faCheck,
    info: faCircleInfo,
    warn: faTriangleExclamation,
    user: faUser,
    biohazard: faBiohazard,
    brain: faBrain,
    walk: faPersonWalking,
    clipboard: faClipboardList,
    heart: faHeartPulse,
    location: faLocationDot,
    industry: faIndustry,
    flask: faFlask,
    leaf: faLeaf,
    drop: faTint,
    shield: faShieldHalved,
    dna: faDna,
  };

  readonly YES_NO_UNKNOWN = YES_NO_UNKNOWN;
  readonly YES_NO_SHORT = YES_NO_SHORT;
  readonly SEVERITY_OPTS = SEVERITY_OPTS;
  readonly SEVERITY_OPTS_SHORT = SEVERITY_OPTS_SHORT;
  readonly FREQUENCY_OPTS = FREQUENCY_OPTS;
  readonly RBD_FREQUENCY_OPTS = RBD_FREQUENCY_OPTS;
  readonly AGE_BANDS = AGE_BANDS;
  readonly SEX_OPTS = SEX_OPTS;
  readonly SMOKING_OPTS = SMOKING_OPTS;
  readonly CAFFEINE_OPTS = CAFFEINE_OPTS;
  readonly SUPERFUND_OPTS = SUPERFUND_OPTS;

  readonly MOTOR_CARDINAL: readonly { key: keyof IntakeForm['motor']; label: string }[] = [
    { key: 'restingTremor', label: 'Resting tremor (hand, arm, or chin trembles while at rest)' },
    { key: 'bradykinesia', label: 'Bradykinesia (slowness initiating or performing movement)' },
    { key: 'rigidity', label: 'Muscle rigidity or stiffness' },
    { key: 'posturalInstability', label: 'Balance problems or postural instability' },
  ];

  readonly MOTOR_SUPPORTING: readonly { key: keyof IntakeForm['motor']; l: string }[] = [
    { key: 'micrographia', l: 'Handwriting has become smaller or cramped' },
    { key: 'shuffledGait', l: 'Shuffled or shortened steps when walking' },
    { key: 'reducedArmSwing', l: 'One arm swings less while walking' },
    { key: 'facialMasking', l: 'Reduced facial expression ("masked face")' },
    { key: 'voiceSoftening', l: 'Voice has become softer or more monotone' },
  ];

  readonly steps: StepDef[] = [
    { key: 'contact', title: 'About you', subtitle: 'Name and consent', icon: faUser },
    { key: 'demographics', title: 'Demographics', subtitle: 'Age, sex, family history', icon: faClipboardList },
    { key: 'environmental', title: 'Environmental exposures', subtitle: 'Camp Lejeune, pesticides, solvents, Superfund sites', icon: faBiohazard },
    { key: 'lifestyle', title: 'Medical & lifestyle', subtitle: 'Head injury, sleep, mood', icon: faHeartPulse },
    { key: 'motor', title: 'Motor symptoms', subtitle: 'Tremor, bradykinesia, gait', icon: faPersonWalking },
    { key: 'nonMotor', title: 'Non-motor symptoms', subtitle: 'Smell, sleep, autonomic signs', icon: faBrain },
    { key: 'review', title: 'Review & export', subtitle: 'Confirm and package your responses', icon: faShieldHalved },
  ];

  readonly stepIndex = signal(0);
  readonly form = signal<IntakeForm>(structuredClone(EMPTY_INTAKE));
  readonly submitted = signal(false);
  readonly payload = signal<IntakePayload | null>(null);

  readonly currentStep = computed(() => this.steps[this.stepIndex()]);
  readonly progress = computed(() =>
    Math.round(((this.stepIndex() + 1) / this.steps.length) * 100),
  );

  readonly canProceedFromContact = computed(() => {
    const c = this.form().contact;
    return c.firstName.trim().length > 0 && c.lastName.trim().length > 0;
  });

  readonly canSubmit = computed(() => this.form().consent);

  next(): void {
    if (this.stepIndex() < this.steps.length - 1) {
      this.stepIndex.update((i) => i + 1);
      this.scrollTop();
    }
  }

  back(): void {
    if (this.stepIndex() > 0) {
      this.stepIndex.update((i) => i - 1);
      this.scrollTop();
    }
  }

  goTo(i: number): void {
    this.stepIndex.set(i);
    this.scrollTop();
  }

  submit(): void {
    this.payload.set(this.payloads.build(this.form()));
    this.submitted.set(true);
    this.scrollTop();
  }

  startOver(): void {
    this.form.set(structuredClone(EMPTY_INTAKE));
    this.payload.set(null);
    this.submitted.set(false);
    this.stepIndex.set(0);
    this.scrollTop();
  }

  patch(section: keyof IntakeForm, update: Record<string, unknown>): void {
    this.form.update((f) => ({
      ...f,
      [section]: { ...(f[section] as object), ...update },
    }));
  }

  patchField(section: keyof IntakeForm, key: string, value: unknown): void {
    this.form.update((f) => ({
      ...f,
      [section]: { ...(f[section] as object), [key]: value },
    }));
  }

  patchChemicals(update: Partial<IntakeForm['environmental']['specificChemicals']>): void {
    this.form.update((f) => ({
      ...f,
      environmental: {
        ...f.environmental,
        specificChemicals: { ...f.environmental.specificChemicals, ...update },
      },
    }));
  }

  private updateEnv(patch: Partial<EnvironmentalExposure>): void {
    this.form.update((f) => ({
      ...f,
      environmental: { ...f.environmental, ...patch },
    }));
  }

  stateNameFor(code: string): string {
    return STATE_NAMES[code] ?? code;
  }

  isStateSelected(code: string): boolean {
    return this.form().environmental.livedInStates.some((s) => s.state === code);
  }

  toggleState(code: string, checked: boolean): void {
    const current = this.form().environmental.livedInStates;
    if (checked && !current.some((s) => s.state === code)) {
      this.updateEnv({
        livedInStates: [...current, { state: code, livedYears: null, nearSiteIds: [] }],
      });
    } else if (!checked) {
      this.updateEnv({ livedInStates: current.filter((s) => s.state !== code) });
    }
  }

  removeState(code: string): void {
    this.updateEnv({
      livedInStates: this.form().environmental.livedInStates.filter((s) => s.state !== code),
    });
  }

  updateStateLivedYears(code: string, years: number | null): void {
    this.updateEnv({
      livedInStates: this.form().environmental.livedInStates.map((s) =>
        s.state === code ? { ...s, livedYears: years } : s,
      ),
    });
  }

  updateStateSiteIds(code: string, ids: string[]): void {
    this.updateEnv({
      livedInStates: this.form().environmental.livedInStates.map((s) =>
        s.state === code ? { ...s, nearSiteIds: ids } : s,
      ),
    });
  }

  patchDiagnoses(update: Partial<IntakeForm['lifestyle']['priorDiagnoses']>): void {
    this.form.update((f) => ({
      ...f,
      lifestyle: {
        ...f.lifestyle,
        priorDiagnoses: { ...f.lifestyle.priorDiagnoses, ...update },
      },
    }));
  }

  setNarrative(v: string): void {
    this.form.update((f) => ({ ...f, narrative: v }));
  }

  setConsent(v: boolean): void {
    this.form.update((f) => ({ ...f, consent: v }));
  }

  isChecked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  private scrollTop(): void {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}
