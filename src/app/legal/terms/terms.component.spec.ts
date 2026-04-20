import { RouterTestingModule } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { TermsComponent } from './terms.component';

describe('TermsComponent', () => {
  it('creates and renders', () => {
    TestBed.configureTestingModule({ imports: [TermsComponent, RouterTestingModule] });
    const fixture = TestBed.createComponent(TermsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toBeTruthy();
  });
});
