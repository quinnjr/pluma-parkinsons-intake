import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { IntakeFormComponent } from './intake-form.component';
import { AuthService, type AuthedUser } from '../shared/auth.service';

const patient: AuthedUser = {
  id: 'u1', email: 'p@x.com', role: 'patient', confirmed: true, mfaEnabled: false,
};

describe('IntakeFormComponent', () => {
  let fixture: ComponentFixture<IntakeFormComponent>;
  let cmp: IntakeFormComponent;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [IntakeFormComponent, HttpClientTestingModule],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.setAuthenticatedUser(patient);
    auth.ready.set(true);
    fixture = TestBed.createComponent(IntakeFormComponent);
    cmp = fixture.componentInstance;
  });

  afterEach(() => {
    // Any afterNextRender-triggered GETs get absorbed here.
    httpMock.match(() => true).forEach((r) => r.flush({ ok: true, states: [] }));
    httpMock.verify();
  });

  it('starts at step 0 with a progress % and empty form', () => {
    expect(cmp.stepIndex()).toBe(0);
    expect(cmp.progress()).toBeGreaterThan(0);
    expect(cmp.currentStep()?.key).toBe('contact');
  });

  it('canProceedFromContact requires first + last name', () => {
    expect(cmp.canProceedFromContact()).toBe(false);
    cmp.patch('contact', { firstName: 'A', lastName: 'B' });
    expect(cmp.canProceedFromContact()).toBe(true);
  });

  it('canSubmit reflects consent flag', () => {
    expect(cmp.canSubmit()).toBe(false);
    cmp.setConsent(true);
    expect(cmp.canSubmit()).toBe(true);
  });

  it('next / back / goTo move the step index (clamped)', () => {
    cmp.next();
    expect(cmp.stepIndex()).toBe(1);
    cmp.back();
    expect(cmp.stepIndex()).toBe(0);
    cmp.back();
    expect(cmp.stepIndex()).toBe(0); // clamped at 0
    cmp.goTo(3);
    expect(cmp.stepIndex()).toBe(3);
    // Repeatedly calling next beyond end clamps.
    for (let i = 0; i < 20; i++) cmp.next();
    expect(cmp.stepIndex()).toBe(cmp.steps.length - 1);
  });

  it('submit builds payload and flips submitted=true', () => {
    cmp.patch('contact', { firstName: 'A', lastName: 'B' });
    cmp.submit();
    expect(cmp.submitted()).toBe(true);
    expect(cmp.payload()).toBeTruthy();
    expect(cmp.payload()!.patient.firstName).toBe('A');
  });

  it('startOver resets form, payload, submitted, stepIndex', () => {
    cmp.patch('contact', { firstName: 'A' });
    cmp.stepIndex.set(3);
    cmp.submitted.set(true);
    cmp.startOver();
    expect(cmp.stepIndex()).toBe(0);
    expect(cmp.submitted()).toBe(false);
    expect(cmp.payload()).toBeNull();
    expect(cmp.form().contact.firstName).toBe('');
  });

  it('patchField updates a single key in a section', () => {
    cmp.patchField('demographics', 'ageBand', '60-69');
    expect(cmp.form().demographics.ageBand).toBe('60-69');
  });

  it('patchChemicals merges flags', () => {
    cmp.patchChemicals({ paraquat: true });
    expect(cmp.form().environmental.specificChemicals.paraquat).toBe(true);
    cmp.patchChemicals({ agentOrange: true });
    expect(cmp.form().environmental.specificChemicals.agentOrange).toBe(true);
    expect(cmp.form().environmental.specificChemicals.paraquat).toBe(true);
  });

  it('patchDiagnoses merges flags', () => {
    cmp.patchDiagnoses({ depression: true });
    expect(cmp.form().lifestyle.priorDiagnoses.depression).toBe(true);
  });

  it('setNarrative + setConsent', () => {
    cmp.setNarrative('x');
    cmp.setConsent(true);
    expect(cmp.form().narrative).toBe('x');
    expect(cmp.form().consent).toBe(true);
  });

  it('isChecked reads the target checkbox state', () => {
    const event = { target: { checked: true } } as unknown as Event;
    expect(cmp.isChecked(event)).toBe(true);
  });

  it('stateNameFor: known codes and fallback', () => {
    expect(cmp.stateNameFor('FL')).toBe('Florida');
    expect(cmp.stateNameFor('ZZ')).toBe('ZZ');
  });

  it('toggleState adds / removes a state entry', () => {
    cmp.toggleState('FL', true);
    expect(cmp.isStateSelected('FL')).toBe(true);
    // duplicate add is a no-op
    cmp.toggleState('FL', true);
    expect(cmp.form().environmental.livedInStates).toHaveLength(1);
    cmp.toggleState('FL', false);
    expect(cmp.isStateSelected('FL')).toBe(false);
  });

  it('removeState filters the list', () => {
    cmp.toggleState('FL', true);
    cmp.toggleState('TX', true);
    cmp.removeState('FL');
    expect(cmp.form().environmental.livedInStates.map((s) => s.state)).toEqual(['TX']);
  });

  it('updateStateLivedYears + updateStateSiteIds mutate the right entry', () => {
    cmp.toggleState('FL', true);
    cmp.updateStateLivedYears('FL', 12);
    cmp.updateStateSiteIds('FL', ['abc']);
    const e = cmp.form().environmental.livedInStates.find((s) => s.state === 'FL')!;
    expect(e.livedYears).toBe(12);
    expect(e.nearSiteIds).toEqual(['abc']);
    // no-op for absent state
    cmp.updateStateLivedYears('ZZ', 1);
    expect(cmp.form().environmental.livedInStates.every((s) => s.state !== 'ZZ')).toBe(true);
  });

  it('signOut logs out and navigates to /admin/login', async () => {
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate');
    const p = cmp.signOut();
    httpMock.expectOne('/api/auth/logout').flush({ ok: true });
    await p;
    expect(nav).toHaveBeenCalledWith(['/admin/login']);
  });

  it('canFillForm is true only for a confirmed patient', () => {
    auth.setAuthenticatedUser(patient);
    expect(cmp.canFillForm()).toBe(true);
    auth.setAuthenticatedUser({ ...patient, confirmed: false });
    expect(cmp.canFillForm()).toBe(false);
    auth.setAuthenticatedUser({ ...patient, role: 'researcher' });
    expect(cmp.canFillForm()).toBe(false);
  });

  it('isSignedInNonPatient reflects non-patient role', () => {
    auth.setAuthenticatedUser({ ...patient, role: 'researcher' });
    expect(cmp.isSignedInNonPatient()).toBe(true);
    auth.setAuthenticatedUser(patient);
    expect(cmp.isSignedInNonPatient()).toBe(false);
  });
});
