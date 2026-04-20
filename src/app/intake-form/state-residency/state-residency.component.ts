import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SuperfundService, type SuperfundSite } from '../../shared/superfund.service';

@Component({
  selector: 'app-state-residency',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './state-residency.component.html',
})
export class StateResidencyComponent {
  private superfund = inject(SuperfundService);

  state = input.required<string>();
  stateName = input.required<string>();
  livedYears = model<number | null>(null);
  nearSiteIds = model<string[]>([]);
  removed = output<void>();

  private sitesSignal = computed(() => this.superfund.sites(this.state()));
  sites = computed<SuperfundSite[]>(() => this.sitesSignal()() ?? []);

  search = model<string>('');

  filteredSites = computed<SuperfundSite[]>(() => {
    const q = this.search().trim().toLowerCase();
    const all = this.sites();
    if (!q) return all;
    return all.filter((s) =>
      s.name.toLowerCase().includes(q)
      || (s.city ?? '').toLowerCase().includes(q)
      || (s.county ?? '').toLowerCase().includes(q),
    );
  });

  checkedCount = computed(() => this.nearSiteIds().length);

  isChecked(siteId: string): boolean {
    return this.nearSiteIds().includes(siteId);
  }

  toggleSite(siteId: string, checked: boolean): void {
    const current = this.nearSiteIds();
    if (checked && !current.includes(siteId)) {
      this.nearSiteIds.set([...current, siteId]);
    } else if (!checked && current.includes(siteId)) {
      this.nearSiteIds.set(current.filter((id) => id !== siteId));
    }
  }
}
