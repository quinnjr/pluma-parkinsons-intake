import { describe, expect, it } from 'vitest';
import { IntakePayloadService } from './risk.service';
import { EMPTY_INTAKE, type IntakeForm } from './risk.model';

function cloneEmpty(): IntakeForm {
  return structuredClone(EMPTY_INTAKE);
}

describe('IntakePayloadService.build', () => {
  const svc = new IntakePayloadService();

  it('emits a payload with six sections + schemaVersion + generatedAt', () => {
    const p = svc.build(cloneEmpty());
    expect(p.schemaVersion).toBe('1.1.0');
    expect(new Date(p.generatedAt).toString()).not.toBe('Invalid Date');
    const ids = p.sections.map((s) => s.id);
    expect(ids).toEqual([
      'demographics',
      'environmental',
      'lifestyle',
      'motor',
      'nonMotor',
      'narrative',
    ]);
  });

  it('copies contact fields into payload.patient', () => {
    const form = cloneEmpty();
    form.contact.firstName = 'Alice';
    form.contact.email = 'alice@example.com';
    const p = svc.build(form);
    expect(p.patient).toEqual(form.contact);
  });

  it('propagates livedInStates from the environmental section', () => {
    const form = cloneEmpty();
    form.environmental.livedInStates = [
      { state: 'FL', livedYears: 12, nearSiteIds: ['id-1'] },
    ];
    expect(svc.build(form).livedInStates).toEqual(form.environmental.livedInStates);
  });

  it('renders conditional Camp Lejeune follow-ups only when stationed=yes', () => {
    const yes = cloneEmpty();
    yes.environmental.campLejeuneStationed = 'yes';
    yes.environmental.campLejeuneMonths = 24;
    yes.environmental.campLejeuneYears = '1980-1982';
    const resYes = svc.build(yes).sections.find((s) => s.id === 'environmental')!;
    expect(resYes.responses.some((r) => r.id === 'campLejeuneMonths')).toBe(true);

    const no = cloneEmpty();
    no.environmental.campLejeuneStationed = 'no';
    const resNo = svc.build(no).sections.find((s) => s.id === 'environmental')!;
    expect(resNo.responses.some((r) => r.id === 'campLejeuneMonths')).toBe(false);
  });

  it('renders dry-cleaner years only when lived above/near = yes', () => {
    const yes = cloneEmpty();
    yes.environmental.livedAboveDryCleaner = 'yes';
    yes.environmental.dryCleanerProximityYears = 5;
    const r = svc.build(yes).sections.find((s) => s.id === 'environmental')!;
    expect(r.responses.some((x) => x.id === 'dryCleanerProximityYears')).toBe(true);
  });

  it('renders agricultural-work years only when agriculturalWork = yes', () => {
    const yes = cloneEmpty();
    yes.environmental.agriculturalWork = 'yes';
    yes.environmental.agriculturalWorkYears = 10;
    const r = svc.build(yes).sections.find((s) => s.id === 'environmental')!;
    expect(r.responses.some((x) => x.id === 'agriculturalWorkYears')).toBe(true);
  });

  it('collapses boolean chemical flags into a label list', () => {
    const form = cloneEmpty();
    form.environmental.specificChemicals.paraquat = true;
    form.environmental.specificChemicals.agentOrange = true;
    const r = svc.build(form).sections.find((s) => s.id === 'environmental')!;
    const chemResp = r.responses.find((x) => x.id === 'specificChemicals')!;
    expect(chemResp.answerLabel).toContain('Paraquat');
    expect(chemResp.answerLabel).toContain('Agent Orange');
  });

  it('renders diagnoses label list in lifestyle section', () => {
    const form = cloneEmpty();
    form.lifestyle.priorDiagnoses.depression = true;
    form.lifestyle.priorDiagnoses.diabetes = true;
    const r = svc.build(form).sections.find((s) => s.id === 'lifestyle')!;
    const diag = r.responses.find((x) => x.id === 'priorDiagnoses')!;
    expect(diag.answerLabel).toContain('Depression');
    expect(diag.answerLabel).toContain('Type 2 diabetes');
  });

  it('omits narrative response when blank', () => {
    const form = cloneEmpty();
    form.narrative = '';
    const r = svc.build(form).sections.find((s) => s.id === 'narrative')!;
    expect(r.responses).toEqual([]);
  });

  it('includes narrative response when provided', () => {
    const form = cloneEmpty();
    form.narrative = 'some notes';
    const r = svc.build(form).sections.find((s) => s.id === 'narrative')!;
    expect(r.responses[0]!.rawValue).toBe('some notes');
  });
});

describe('IntakePayloadService.anonymize', () => {
  const svc = new IntakePayloadService();

  it('drops firstName/lastName/email from payload.patient shape', () => {
    const form = cloneEmpty();
    form.contact.firstName = 'Alice';
    form.contact.lastName = 'Smith';
    form.contact.email = 'alice@example.com';
    form.contact.zipCode = '33130';
    const anon = svc.anonymize(svc.build(form));
    expect(anon).not.toHaveProperty('patient');
    expect(anon.zipCode).toBe('33130');
  });

  it('normalizes a ZIP+4 input', () => {
    const form = cloneEmpty();
    form.contact.zipCode = '33130-1234';
    expect(svc.anonymize(svc.build(form)).zipCode).toBe('33130-1234');
  });

  it('returns null zipCode for a malformed value', () => {
    const form = cloneEmpty();
    form.contact.zipCode = 'xyz';
    expect(svc.anonymize(svc.build(form)).zipCode).toBeNull();
  });

  it('returns null zipCode when empty', () => {
    expect(svc.anonymize(svc.build(cloneEmpty())).zipCode).toBeNull();
  });

  it('copies livedInStates through unchanged', () => {
    const form = cloneEmpty();
    form.environmental.livedInStates = [
      { state: 'FL', livedYears: null, nearSiteIds: [] },
    ];
    expect(svc.anonymize(svc.build(form)).livedInStates).toEqual(form.environmental.livedInStates);
  });

  it('pulls ageBand + sexAtBirth from the demographics section', () => {
    const form = cloneEmpty();
    form.demographics.ageBand = '60-69';
    form.demographics.sexAtBirth = 'male';
    const anon = svc.anonymize(svc.build(form));
    expect(anon.ageBand).toBe('60-69');
    expect(anon.sexAtBirth).toBe('male');
  });

  it('emits markdown that includes the schema tag + subject line', () => {
    const form = cloneEmpty();
    form.demographics.ageBand = '60-69';
    form.demographics.sexAtBirth = 'male';
    form.contact.zipCode = '33130';
    const md = svc.anonymize(svc.build(form)).markdown;
    expect(md).toContain('# Parkinson');
    expect(md).toContain('**Schema:** intake/1.1.0');
    expect(md).toContain('age band 60-69');
    expect(md).toContain('sex male');
    expect(md).toContain('ZIP 33130');
  });

  it("emits 'anonymous' subject line when demographics are blank", () => {
    const md = svc.anonymize(svc.build(cloneEmpty())).markdown;
    expect(md).toContain('**Subject:** anonymous');
  });

  it('omits sections with zero responses from markdown', () => {
    const md = svc.anonymize(svc.build(cloneEmpty())).markdown;
    expect(md).not.toContain('## Free-text notes');
  });
});

describe('IntakePayloadService.toMarkdown', () => {
  const svc = new IntakePayloadService();

  it('renders subject + responses from a prebuilt payload', () => {
    const form = cloneEmpty();
    form.demographics.ageBand = '50-59';
    const payload = svc.build(form);
    const md = svc.toMarkdown({
      schemaVersion: payload.schemaVersion,
      generatedAt: payload.generatedAt,
      zipCode: null,
      ageBand: '50-59',
      sexAtBirth: null,
      sections: payload.sections,
      livedInStates: [],
    });
    expect(md).toContain('age band 50-59');
    expect(md).toContain('## Demographics');
  });
});
