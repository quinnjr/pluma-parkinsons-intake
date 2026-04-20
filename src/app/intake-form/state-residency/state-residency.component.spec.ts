import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { StateResidencyComponent } from './state-residency.component';

const sites = [
  { id: 'a', epaId: 'A', name: 'Alpha',   city: 'Miami',   county: 'Dade', zipCode: '33130', status: 'final',    contaminants: null, epaUrl: null },
  { id: 'b', epaId: 'B', name: 'Bravo',   city: 'Tampa',   county: 'Hillsborough', zipCode: '33605', status: 'deleted', contaminants: null, epaUrl: null },
  { id: 'c', epaId: 'C', name: 'Charlie', city: null,      county: null, zipCode: null, status: 'final', contaminants: null, epaUrl: null },
];

describe('StateResidencyComponent', () => {
  let fixture: ComponentFixture<StateResidencyComponent>;
  let cmp: StateResidencyComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StateResidencyComponent, HttpClientTestingModule],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StateResidencyComponent);
    fixture.componentRef.setInput('state', 'FL');
    fixture.componentRef.setInput('stateName', 'Florida');
    cmp = fixture.componentInstance;
    fixture.detectChanges();
    // Flush the GET triggered by the computed sitesSignal.
    httpMock.expectOne('/api/superfund/sites?state=FL').flush({ ok: true, sites });
  });

  afterEach(() => httpMock.verify());

  it('creates and loads sites', async () => {
    // Let the service's Promise.then() fire
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(cmp.sites()).toHaveLength(3);
  });

  it('filteredSites returns all when the search is blank', async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    cmp.search.set('  ');
    expect(cmp.filteredSites()).toHaveLength(3);
  });

  it('filteredSites matches by name / city / county (case-insensitive)', async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    cmp.search.set('alpha');
    expect(cmp.filteredSites().map((s) => s.id)).toEqual(['a']);
    cmp.search.set('TAMPA');
    expect(cmp.filteredSites().map((s) => s.id)).toEqual(['b']);
    cmp.search.set('dade');
    expect(cmp.filteredSites().map((s) => s.id)).toEqual(['a']);
  });

  it('toggleSite adds and removes from nearSiteIds (set semantics)', () => {
    expect(cmp.isChecked('a')).toBe(false);
    cmp.toggleSite('a', true);
    expect(cmp.nearSiteIds()).toEqual(['a']);
    // duplicate add is a no-op
    cmp.toggleSite('a', true);
    expect(cmp.nearSiteIds()).toEqual(['a']);
    cmp.toggleSite('b', true);
    expect(cmp.nearSiteIds()).toEqual(['a', 'b']);
    cmp.toggleSite('a', false);
    expect(cmp.nearSiteIds()).toEqual(['b']);
    // remove missing is a no-op
    cmp.toggleSite('z', false);
    expect(cmp.nearSiteIds()).toEqual(['b']);
  });

  it('checkedCount tracks nearSiteIds length', () => {
    cmp.nearSiteIds.set(['x', 'y']);
    expect(cmp.checkedCount()).toBe(2);
  });
});
