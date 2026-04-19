import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

// Thin Promise-returning wrapper around HttpClient so service methods can
// avoid repeating `firstValueFrom(this.http.X<T>(url))` everywhere.
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private http = inject(HttpClient);

  get<T>(url: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(url));
  }

  post<T>(url: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(url, body));
  }

  put<T>(url: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.put<T>(url, body));
  }

  delete<T = { ok: true }>(url: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(url));
  }
}
