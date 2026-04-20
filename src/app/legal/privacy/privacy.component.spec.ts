import { RouterTestingModule } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PrivacyComponent } from './privacy.component';

describe('PrivacyComponent', () => {
  it('creates and renders', () => {
    TestBed.configureTestingModule({ imports: [PrivacyComponent, RouterTestingModule] });
    const fixture = TestBed.createComponent(PrivacyComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toBeTruthy();
  });
});
