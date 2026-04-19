import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideClientHydration } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { APP_ICONS } from './icons';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideClientHydration(),
    provideHttpClient(withFetch()),
    provideRouter(routes, withComponentInputBinding()),
    provideAppInitializer(() => {
      inject(FaIconLibrary).addIcons(...APP_ICONS);
    }),
  ],
};
