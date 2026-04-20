import { Injectable, inject, signal, type Signal } from '@angular/core';
import { ApiClient } from './api-client';

export interface SuperfundStateInfo {
  state: string;
  siteCount: number;
}

export interface SuperfundSite {
  id: string;
  epaId: string;
  name: string;
  city: string | null;
  county: string | null;
  zipCode: string | null;
  status: string;
  contaminants: string | null;
  epaUrl: string | null;
}

@Injectable({ providedIn: 'root' })
export class SuperfundService {
  private api = inject(ApiClient);
  private statesCache = signal<SuperfundStateInfo[] | null>(null);
  private siteCache = new Map<string, Signal<SuperfundSite[] | null>>();

  readonly states = this.statesCache.asReadonly();

  async loadStates(): Promise<void> {
    if (this.statesCache() !== null) return;
    try {
      const res = await this.api.get<{ ok: true; states: SuperfundStateInfo[] }>(
        '/api/superfund/states',
      );
      this.statesCache.set(res.states);
    } catch (err) {
      console.error('[superfund.service] loadStates failed', err);
      this.statesCache.set([]);
    }
  }

  sites(state: string): Signal<SuperfundSite[] | null> {
    const key = state.toUpperCase();
    const existing = this.siteCache.get(key);
    if (existing) return existing;
    const s = signal<SuperfundSite[] | null>(null);
    this.siteCache.set(key, s);
    void this.api
      .get<{ ok: true; sites: SuperfundSite[] }>(`/api/superfund/sites?state=${key}`)
      .then((res) => s.set(res.sites))
      .catch((err) => {
        console.error('[superfund.service] sites load failed', err);
        s.set([]);
      });
    return s;
  }
}
