import { Injectable } from '@angular/core';
import {
  AnonymizedPayload,
  EnvironmentalExposure,
  Frequency,
  IntakeForm,
  IntakePayload,
  IntakeResponse,
  IntakeSection,
  IntakeSectionId,
  LifestyleAndMedical,
  MotorSymptoms,
  NonMotorSymptoms,
  SymptomSeverity,
  YesNoUnknown,
} from './risk.model';

const SCHEMA_VERSION = '1.0.0';

const YES_NO_LABELS: Record<YesNoUnknown | '', string> = {
  yes: 'Yes',
  no: 'No',
  unknown: 'Not sure',
  '': 'Not answered',
};

const SEVERITY_LABELS: Record<SymptomSeverity | '', string> = {
  none: 'None',
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
  '': 'Not answered',
};

const FREQUENCY_LABELS: Record<Frequency | '', string> = {
  never: 'Never',
  rare: 'Rarely',
  occasional: 'Occasionally',
  frequent: 'Frequently',
  daily: 'Daily',
  '': 'Not answered',
};

@Injectable({ providedIn: 'root' })
export class IntakePayloadService {
  build(form: IntakeForm): IntakePayload {
    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      patient: { ...form.contact },
      sections: [
        this.demographicsSection(form),
        this.environmentalSection(form.environmental),
        this.lifestyleSection(form.lifestyle),
        this.motorSection(form.motor),
        this.nonMotorSection(form.nonMotor),
        this.narrativeSection(form.narrative),
      ],
    };
  }

  anonymize(payload: IntakePayload): AnonymizedPayload {
    const demo = payload.sections.find((s) => s.id === 'demographics');
    const core: Omit<AnonymizedPayload, 'markdown'> = {
      schemaVersion: payload.schemaVersion,
      generatedAt: payload.generatedAt,
      zipCode: this.normalizeZip(payload.patient.zipCode),
      ageBand: demoValue(demo, 'ageBand'),
      sexAtBirth: demoValue(demo, 'sexAtBirth'),
      sections: payload.sections,
    };
    return { ...core, markdown: this.toMarkdown(core) };
  }

  toMarkdown(payload: Omit<AnonymizedPayload, 'markdown'>): string {
    const lines: string[] = [ '# Parkinson\u2019s Risk-Factor Intake', ''];
    const tags: string[] = [];
    if (payload.ageBand) tags.push(`age band ${payload.ageBand}`);
    if (payload.sexAtBirth) tags.push(`sex ${payload.sexAtBirth}`);
    if (payload.zipCode) tags.push(`ZIP ${payload.zipCode}`);
    lines.push(`**Subject:** ${tags.length > 0 ? tags.join(', ') : 'anonymous'}`);
    lines.push(`**Completed:** ${payload.generatedAt}`);
    lines.push(`**Schema:** intake/${payload.schemaVersion}`);
    lines.push('');
    lines.push(
      'The following self-reported responses are provided for downstream multi-omics contextual analysis. No risk score or diagnosis has been generated from them. Name and email have been stripped client-side; the full ZIP is retained for geo-correlation and is encrypted at rest.',
    );
    lines.push('');
    for (const section of payload.sections) {
      if (section.responses.length === 0) continue;
      lines.push(`## ${section.title}`);
      for (const r of section.responses) {
        lines.push(`- **${r.question}** \u2014 ${r.answerLabel}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private normalizeZip(zip: string | null | undefined): string | null {
    if (!zip) return null;
    const trimmed = zip.trim();
    if (!trimmed) return null;
    return /^\d{5}(-\d{4})?$/.test(trimmed) ? trimmed : null;
  }

  private demographicsSection(form: IntakeForm): IntakeSection {
    const d = form.demographics;
    const sexLabels: Record<string, string> = {
      male: 'Male', female: 'Female', intersex: 'Intersex', 'prefer-not': 'Prefer not to say', '': 'Not answered',
    };
    return this.section('demographics', 'Demographics', [
      this.response('ageBand', 'Age range', d.ageBand, d.ageBand || 'Not answered'),
      this.response('sexAtBirth', 'Sex at birth', d.sexAtBirth, sexLabels[d.sexAtBirth]),
      this.response('familyHistory', 'First-degree relative with Parkinson\u2019s disease', d.familyHistory, YES_NO_LABELS[d.familyHistory]),
      this.response('geneticTesting', 'Genetic testing (GBA, LRRK2, SNCA)', d.geneticTesting, YES_NO_LABELS[d.geneticTesting]),
    ]);
  }

  private environmentalSection(env: EnvironmentalExposure): IntakeSection {
    const proximity: Record<string, string> = {
      none: 'None / never',
      'under-1mi': 'Within 1 mile',
      '1-5mi': '1\u20135 miles',
      '5-10mi': '5\u201310 miles',
      unknown: 'Not sure',
      '': 'Not answered',
    };

    const chemicals: string[] = Object.entries(env.specificChemicals)
      .filter(([, v]) => v)
      .map(([k]) => ({
        paraquat: 'Paraquat',
        rotenone: 'Rotenone',
        organochlorines: 'Organochlorines (DDT, dieldrin)',
        glyphosate: 'Glyphosate (Roundup, occupational)',
        agentOrange: 'Agent Orange / dioxin',
      }[k as keyof EnvironmentalExposure['specificChemicals']]));

    const responses: IntakeResponse[] = [
      this.response('campLejeuneStationed', 'Stationed/resided at Camp Lejeune for \u226530 days between 1953\u20131987', env.campLejeuneStationed, YES_NO_LABELS[env.campLejeuneStationed]),
    ];
    if (env.campLejeuneStationed === 'yes') {
      responses.push(
        this.response('campLejeuneMonths', 'Months stationed at Camp Lejeune', env.campLejeuneMonths, env.campLejeuneMonths != null ? `${env.campLejeuneMonths} months` : 'Not specified'),
        this.response('campLejeuneYears', 'Years of service at Camp Lejeune', env.campLejeuneYears, env.campLejeuneYears || 'Not specified'),
      );
    }
    responses.push(
      this.response('livedAboveDryCleaner', 'Lived directly above a dry cleaner or laundromat', env.livedAboveDryCleaner, YES_NO_LABELS[env.livedAboveDryCleaner]),
      this.response('livedNearDryCleaner', 'Lived adjacent to a dry cleaner or laundromat', env.livedNearDryCleaner, YES_NO_LABELS[env.livedNearDryCleaner]),
    );
    if (env.livedAboveDryCleaner === 'yes' || env.livedNearDryCleaner === 'yes') {
      responses.push(
        this.response('dryCleanerProximityYears', 'Years at that residence', env.dryCleanerProximityYears, env.dryCleanerProximityYears != null ? `${env.dryCleanerProximityYears} years` : 'Not specified'),
      );
    }
    responses.push(
      this.response('pesticideOccupational', 'Occupational pesticide / herbicide use', env.pesticideOccupational, YES_NO_LABELS[env.pesticideOccupational]),
      this.response('pesticideHome', 'Frequency of home pesticide use', env.pesticideHome, FREQUENCY_LABELS[env.pesticideHome]),
      this.response('agriculturalWork', 'Worked in agriculture / farming', env.agriculturalWork, YES_NO_LABELS[env.agriculturalWork]),
    );
    if (env.agriculturalWork === 'yes') {
      responses.push(
        this.response('agriculturalWorkYears', 'Years of agricultural work', env.agriculturalWorkYears, env.agriculturalWorkYears != null ? `${env.agriculturalWorkYears} years` : 'Not specified'),
      );
    }
    responses.push(
      this.response('specificChemicals', 'Known direct exposure to specific chemicals', chemicals, chemicals.length > 0 ? chemicals.join(', ') : 'None reported'),
      this.response('superfundProximity', 'Closest residence to an EPA Superfund / industrial-contamination site', env.superfundProximity, proximity[env.superfundProximity]),
      this.response('wellWaterYears', 'Years drinking from a private well', env.wellWaterYears, env.wellWaterYears != null ? `${env.wellWaterYears} years` : 'Not specified'),
      this.response('industrialSolvents', 'Occupational contact with industrial solvents (TCE, PCE, methylene chloride)', env.industrialSolvents, YES_NO_LABELS[env.industrialSolvents]),
      this.response('welderManganese', 'Welding / manganese-fume exposure', env.welderManganese, YES_NO_LABELS[env.welderManganese]),
      this.response('leadPipeExposure', 'Lead pipe or paint exposure', env.leadPipeExposure, YES_NO_LABELS[env.leadPipeExposure]),
      this.response('heavyMetalExposure', 'Other heavy-metal exposure (mercury, cadmium)', env.heavyMetalExposure, YES_NO_LABELS[env.heavyMetalExposure]),
    );
    return this.section('environmental', 'Environmental & occupational exposures', responses);
  }

  private lifestyleSection(l: LifestyleAndMedical): IntakeSection {
    const smokingLabels: Record<string, string> = {
      never: 'Never smoked', former: 'Former smoker', current: 'Current smoker', '': 'Not answered',
    };
    const caffeineLabels: Record<string, string> = {
      none: 'None', light: '1 cup/day', moderate: '2\u20133 cups/day', heavy: '4+ cups/day', '': 'Not answered',
    };
    const diagLabels: Record<keyof LifestyleAndMedical['priorDiagnoses'], string> = {
      remSleepBehaviorDisorder: 'REM sleep behavior disorder',
      anosmia: 'Anosmia / hyposmia',
      depression: 'Depression',
      anxiety: 'Anxiety disorder',
      constipationChronic: 'Chronic constipation',
      diabetes: 'Type 2 diabetes',
    };
    const diagnoses = (Object.entries(l.priorDiagnoses) as [keyof LifestyleAndMedical['priorDiagnoses'], boolean][])
      .filter(([, v]) => v)
      .map(([k]) => diagLabels[k]);

    return this.section('lifestyle', 'Medical & lifestyle', [
      this.response('headInjuryLossOfConsciousness', 'Head injury with loss of consciousness', l.headInjuryLossOfConsciousness, YES_NO_LABELS[l.headInjuryLossOfConsciousness]),
      this.response('repeatedHeadTrauma', 'Repeated head trauma (contact sports, military, boxing)', l.repeatedHeadTrauma, YES_NO_LABELS[l.repeatedHeadTrauma]),
      this.response('smokingStatus', 'Smoking status', l.smokingStatus, smokingLabels[l.smokingStatus]),
      this.response('caffeineDaily', 'Daily caffeine intake', l.caffeineDaily, caffeineLabels[l.caffeineDaily]),
      this.response('priorDiagnoses', 'Prior or current diagnoses', diagnoses, diagnoses.length > 0 ? diagnoses.join(', ') : 'None reported'),
      this.response('medications', 'Current medications', l.medications, l.medications || 'Not provided'),
    ]);
  }

  private motorSection(m: MotorSymptoms): IntakeSection {
    return this.section('motor', 'Motor symptoms', [
      this.response('restingTremor', 'Resting tremor', m.restingTremor, SEVERITY_LABELS[m.restingTremor]),
      this.response('tremorOneSided', 'Tremor or stiffness noticeably one-sided', m.tremorOneSided, YES_NO_LABELS[m.tremorOneSided]),
      this.response('bradykinesia', 'Bradykinesia (slowness of movement)', m.bradykinesia, SEVERITY_LABELS[m.bradykinesia]),
      this.response('rigidity', 'Muscle rigidity', m.rigidity, SEVERITY_LABELS[m.rigidity]),
      this.response('posturalInstability', 'Postural instability / balance problems', m.posturalInstability, SEVERITY_LABELS[m.posturalInstability]),
      this.response('micrographia', 'Smaller handwriting (micrographia)', m.micrographia, YES_NO_LABELS[m.micrographia]),
      this.response('shuffledGait', 'Shuffled / shortened gait', m.shuffledGait, YES_NO_LABELS[m.shuffledGait]),
      this.response('reducedArmSwing', 'Reduced arm swing while walking', m.reducedArmSwing, YES_NO_LABELS[m.reducedArmSwing]),
      this.response('facialMasking', 'Reduced facial expression (hypomimia)', m.facialMasking, YES_NO_LABELS[m.facialMasking]),
      this.response('voiceSoftening', 'Voice softening / hypophonia', m.voiceSoftening, YES_NO_LABELS[m.voiceSoftening]),
    ]);
  }

  private nonMotorSection(n: NonMotorSymptoms): IntakeSection {
    return this.section('nonMotor', 'Non-motor symptoms', [
      this.response('smellLoss', 'Reduced sense of smell', n.smellLoss, SEVERITY_LABELS[n.smellLoss]),
      this.response('sleepActingOutDreams', 'Physically acts out dreams', n.sleepActingOutDreams, FREQUENCY_LABELS[n.sleepActingOutDreams]),
      this.response('constipation', 'Constipation frequency', n.constipation, FREQUENCY_LABELS[n.constipation]),
      this.response('mood', 'Mood changes (low mood, apathy)', n.mood, SEVERITY_LABELS[n.mood]),
      this.response('cognitiveChanges', 'Cognitive / memory changes', n.cognitiveChanges, SEVERITY_LABELS[n.cognitiveChanges]),
      this.response('orthostatic', 'Lightheadedness when standing', n.orthostatic, YES_NO_LABELS[n.orthostatic]),
      this.response('urinaryUrgency', 'Urinary urgency', n.urinaryUrgency, YES_NO_LABELS[n.urinaryUrgency]),
    ]);
  }

  private narrativeSection(narrative: string): IntakeSection {
    return this.section('narrative', 'Free-text notes',
      narrative.trim() ? [this.response('narrative', 'Additional notes', narrative, narrative)] : [],
    );
  }

  private section(id: IntakeSectionId, title: string, responses: IntakeResponse[]): IntakeSection {
    return { id, title, responses };
  }

  private response(id: string, question: string, rawValue: unknown, answerLabel: string): IntakeResponse {
    return { id, question, rawValue, answerLabel };
  }
}

function demoValue(
  section: IntakeSection | undefined,
  responseId: 'ageBand' | 'sexAtBirth',
): string | null {
  const v = section?.responses.find((r) => r.id === responseId)?.rawValue;
  return typeof v === 'string' && v.length > 0 ? v : null;
}
