import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter
} from '@angular/router';

import { authGuard } from './auth.guard';

describe('authGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])]
    });
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function executeGuard(): boolean | UrlTree {
    return TestBed.runInInjectionContext(() =>
      authGuard(
        {} as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot
      ) as boolean | UrlTree
    );
  }

  it('allows navigation when an access token exists', () => {
    sessionStorage.setItem('access_token', 'test-token');

    expect(executeGuard()).toBeTrue();
  });

  it('redirects to login when an access token does not exist', () => {
    const result = executeGuard() as UrlTree;
    const router = TestBed.inject(Router);

    expect(router.serializeUrl(result)).toBe('/login');
  });
});
