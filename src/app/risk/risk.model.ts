export type YesNoUnknown = 'yes' | 'no' | 'unknown';

export type Frequency = 'never' | 'rare' | 'occasional' | 'frequent' | 'daily';

export type SymptomSeverity = 'none' | 'mild' | 'moderate' | 'severe';

export interface Demographics {
  ageBand: '<40' | '40-49' | '50-59' | '60-69' | '70-79' | '80+' | '';
  sexAtBirth: 'male' | 'female' | 'intersex' | 'prefer-not' | '';
  familyHistory: YesNoUnknown | '';
  geneticTesting: YesNoUnknown | '';
}

export interface StateResidency {
  state: string;            // 2-letter USPS code
  livedYears: number | null;
  nearSiteIds: string[];    // SuperfundSite.id values
}

export interface EnvironmentalExposure {
  // Camp Lejeune (TCE / PCE / benzene / vinyl chloride contaminated drinking water 1953-1987)
  campLejeuneStationed: YesNoUnknown | '';
  campLejeuneMonths: number | null;
  campLejeuneYears: string;

  // Living near or above a dry cleaner / laundromat (tetrachloroethylene / PCE)
  livedAboveDryCleaner: YesNoUnknown | '';
  livedNearDryCleaner: YesNoUnknown | '';
  dryCleanerProximityYears: number | null;

  // Pesticide / herbicide exposure (rotenone, paraquat, organochlorines)
  pesticideOccupational: YesNoUnknown | '';
  pesticideHome: Frequency | '';
  agriculturalWork: YesNoUnknown | '';
  agriculturalWorkYears: number | null;
  specificChemicals: {
    paraquat: boolean;
    rotenone: boolean;
    organochlorines: boolean;
    glyphosate: boolean;
    agentOrange: boolean;
  };

  // Superfund / industrial / groundwater contamination
  superfundProximity: 'none' | 'under-1mi' | '1-5mi' | '5-10mi' | 'unknown' | '';
  wellWaterYears: number | null;
  industrialSolvents: YesNoUnknown | '';

  // Heavy metals & other
  heavyMetalExposure: YesNoUnknown | '';
  welderManganese: YesNoUnknown | '';
  leadPipeExposure: YesNoUnknown | '';
  livedInStates: StateResidency[];
}

export interface LifestyleAndMedical {
  headInjuryLossOfConsciousness: YesNoUnknown | '';
  repeatedHeadTrauma: YesNoUnknown | '';
  smokingStatus: 'never' | 'former' | 'current' | '';
  caffeineDaily: 'none' | 'light' | 'moderate' | 'heavy' | '';
  priorDiagnoses: {
    remSleepBehaviorDisorder: boolean;
    depression: boolean;
    anxiety: boolean;
    constipationChronic: boolean;
    anosmia: boolean;
    diabetes: boolean;
  };
  medications: string;
}

export interface MotorSymptoms {
  restingTremor: SymptomSeverity | '';
  tremorOneSided: YesNoUnknown | '';
  bradykinesia: SymptomSeverity | '';
  rigidity: SymptomSeverity | '';
  posturalInstability: SymptomSeverity | '';
  micrographia: YesNoUnknown | '';
  shuffledGait: YesNoUnknown | '';
  reducedArmSwing: YesNoUnknown | '';
  facialMasking: YesNoUnknown | '';
  voiceSoftening: YesNoUnknown | '';
}

export interface NonMotorSymptoms {
  smellLoss: SymptomSeverity | '';
  sleepActingOutDreams: Frequency | '';
  constipation: Frequency | '';
  mood: SymptomSeverity | '';
  cognitiveChanges: SymptomSeverity | '';
  orthostatic: YesNoUnknown | '';
  urinaryUrgency: YesNoUnknown | '';
}

export interface IntakeForm {
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    zipCode: string;
  };
  demographics: Demographics;
  environmental: EnvironmentalExposure;
  lifestyle: LifestyleAndMedical;
  motor: MotorSymptoms;
  nonMotor: NonMotorSymptoms;
  narrative: string;
  consent: boolean;
}

export type IntakeSectionId =
  | 'demographics'
  | 'environmental'
  | 'lifestyle'
  | 'motor'
  | 'nonMotor'
  | 'narrative';

export interface IntakeResponse {
  id: string;
  question: string;
  rawValue: unknown;
  answerLabel: string;
}

export interface IntakeSection {
  id: IntakeSectionId;
  title: string;
  responses: IntakeResponse[];
}

export interface IntakePayload {
  schemaVersion: string;
  generatedAt: string;
  patient: IntakeForm['contact'];
  sections: IntakeSection[];
  livedInStates: StateResidency[];
}

export interface AnonymizedPayload {
  schemaVersion: string;
  generatedAt: string;
  zipCode: string | null;
  ageBand: string | null;
  sexAtBirth: string | null;
  markdown: string;
  sections: IntakeSection[];
  livedInStates: StateResidency[];
}

export const EMPTY_INTAKE: IntakeForm = {
  contact: { firstName: '', lastName: '', email: '', zipCode: '' },
  demographics: {
    ageBand: '',
    sexAtBirth: '',
    familyHistory: '',
    geneticTesting: '',
  },
  environmental: {
    campLejeuneStationed: '',
    campLejeuneMonths: null,
    campLejeuneYears: '',
    livedAboveDryCleaner: '',
    livedNearDryCleaner: '',
    dryCleanerProximityYears: null,
    pesticideOccupational: '',
    pesticideHome: '',
    agriculturalWork: '',
    agriculturalWorkYears: null,
    specificChemicals: {
      paraquat: false,
      rotenone: false,
      organochlorines: false,
      glyphosate: false,
      agentOrange: false,
    },
    superfundProximity: '',
    wellWaterYears: null,
    industrialSolvents: '',
    heavyMetalExposure: '',
    welderManganese: '',
    leadPipeExposure: '',
    livedInStates: [],
  },
  lifestyle: {
    headInjuryLossOfConsciousness: '',
    repeatedHeadTrauma: '',
    smokingStatus: '',
    caffeineDaily: '',
    priorDiagnoses: {
      remSleepBehaviorDisorder: false,
      depression: false,
      anxiety: false,
      constipationChronic: false,
      anosmia: false,
      diabetes: false,
    },
    medications: '',
  },
  motor: {
    restingTremor: '',
    tremorOneSided: '',
    bradykinesia: '',
    rigidity: '',
    posturalInstability: '',
    micrographia: '',
    shuffledGait: '',
    reducedArmSwing: '',
    facialMasking: '',
    voiceSoftening: '',
  },
  nonMotor: {
    smellLoss: '',
    sleepActingOutDreams: '',
    constipation: '',
    mood: '',
    cognitiveChanges: '',
    orthostatic: '',
    urinaryUrgency: '',
  },
  narrative: '',
  consent: false,
};
