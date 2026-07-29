import { Injectable, NgZone, OnDestroy, signal } from '@angular/core';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type Unsubscribe as AuthUnsubscribe,
  type User,
} from 'firebase/auth';
import { getDatabase, onValue, ref, set, type Unsubscribe as DatabaseUnsubscribe } from 'firebase/database';
import { environment } from '../environments/environment';
import type { Competition, SavedSchedule, Wod } from './app';

type SyncState = 'idle' | 'loading' | 'saving' | 'saved' | 'offline' | 'error';

const firebaseApp = getApps().length ? getApp() : initializeApp(environment.firebaseConfig);
const CACHE_PREFIX = 'wodflow.competitions.';
const PENDING_PREFIX = 'wodflow.pending.';

@Injectable({ providedIn: 'root' })
export class FirebaseService implements OnDestroy {
  readonly user = signal<User | null>(null);
  readonly authReady = signal(false);
  readonly dataReady = signal(false);
  readonly competitions = signal<Competition[]>([]);
  readonly authError = signal('');
  readonly isOnline = signal(this.browserIsOnline());
  readonly syncState = signal<SyncState>('idle');

  private readonly auth = getAuth(firebaseApp);
  private readonly database = getDatabase(firebaseApp);
  private readonly handleOnline = () => {
    this.zone.run(() => {
      this.isOnline.set(true);
      void this.flushPendingChanges();
    });
  };
  private readonly handleOffline = () => {
    this.zone.run(() => {
      this.isOnline.set(false);
      if (this.user()) this.syncState.set('offline');
    });
  };
  private authListener: AuthUnsubscribe | null = null;
  private dataListener: DatabaseUnsubscribe | null = null;
  private lastRemoteValue = '';

  constructor(private readonly zone: NgZone) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }

    this.authListener = onAuthStateChanged(this.auth, (user) => {
      this.zone.run(() => {
        this.user.set(user);
        this.authReady.set(true);
        this.watchCompetitions(user);
      });
    });
  }

  ngOnDestroy(): void {
    this.authListener?.();
    this.dataListener?.();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }

  async signIn(identifier: string, password: string): Promise<void> {
    this.authError.set('');
    try {
      await signInWithEmailAndPassword(this.auth, this.toFirebaseEmail(identifier), password);
    } catch (error) {
      this.authError.set(this.toAuthMessage(error));
      throw error;
    }
  }

  async register(identifier: string, password: string): Promise<void> {
    this.authError.set('');
    try {
      const credential = await createUserWithEmailAndPassword(this.auth, this.toFirebaseEmail(identifier), password);
      await updateProfile(credential.user, { displayName: this.toUsername(identifier) });
      this.user.set(credential.user);
    } catch (error) {
      this.authError.set(this.toAuthMessage(error));
      throw error;
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
  }

  async saveCompetitions(competitions: Competition[]): Promise<void> {
    const currentUser = this.user();
    if (!currentUser || !this.dataReady()) return;

    const serialized = JSON.stringify(competitions);
    this.writeCache(currentUser.uid, serialized);

    if (!this.isOnline()) {
      this.queuePending(currentUser.uid, serialized);
      this.syncState.set('offline');
      return;
    }

    if (serialized === this.lastRemoteValue && !this.hasPending(currentUser.uid)) return;

    this.queuePending(currentUser.uid, serialized);
    await this.flushPendingChanges();
  }

  private watchCompetitions(user: User | null): void {
    this.dataListener?.();
    this.dataListener = null;
    this.dataReady.set(false);
    this.lastRemoteValue = '';
    this.competitions.set([]);

    if (!user) {
      this.syncState.set('idle');
      return;
    }

    const cached = this.readCache(user.uid);
    const pending = this.readPending(user.uid);
    const localData = pending ?? cached;
    if (localData) {
      this.competitions.set(localData);
      this.lastRemoteValue = pending ? '' : JSON.stringify(localData);
    }
    this.dataReady.set(true);
    this.syncState.set(this.isOnline() ? 'loading' : 'offline');

    const competitionsRef = ref(this.database, `users/${user.uid}/competitions`);
    this.dataListener = onValue(
      competitionsRef,
      (snapshot) => {
        this.zone.run(() => {
          const queued = this.readPending(user.uid);
          if (queued) {
            this.competitions.set(queued);
            this.syncState.set(this.isOnline() ? 'saving' : 'offline');
            void this.flushPendingChanges();
            return;
          }

          const raw = snapshot.val() as Record<string, Competition> | null;
          const competitions = this.normalizeCompetitions(raw);
          this.lastRemoteValue = JSON.stringify(competitions);
          this.writeCache(user.uid, this.lastRemoteValue);
          this.competitions.set(competitions);
          this.dataReady.set(true);
          this.syncState.set('saved');
        });
      },
      () => {
        this.zone.run(() => {
          this.dataReady.set(true);
          this.syncState.set(this.isOnline() ? 'error' : 'offline');
        });
      },
    );
  }

  private async flushPendingChanges(): Promise<void> {
    const currentUser = this.user();
    if (!currentUser || !this.dataReady() || !this.isOnline()) return;

    const serialized = this.readPendingSerialized(currentUser.uid);
    if (!serialized) {
      if (this.syncState() === 'offline') this.syncState.set('saved');
      return;
    }

    this.syncState.set('saving');
    const byId = Object.fromEntries(JSON.parse(serialized).map((competition: Competition) => [competition.id, competition]));
    try {
      await set(ref(this.database, `users/${currentUser.uid}/competitions`), byId);
      this.removePending(currentUser.uid);
      this.lastRemoteValue = serialized;
      this.syncState.set('saved');
    } catch {
      this.syncState.set(this.isOnline() ? 'error' : 'offline');
    }
  }

  private readCache(uid: string): Competition[] | null {
    return this.readSerialized(this.cacheKey(uid));
  }

  private readPending(uid: string): Competition[] | null {
    return this.readSerialized(this.pendingKey(uid));
  }

  private readPendingSerialized(uid: string): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(this.pendingKey(uid));
  }

  private readSerialized(key: string): Competition[] | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const competitions = this.normalizeCompetitions(parsed);
      return competitions;
    } catch {
      return null;
    }
  }

  private writeCache(uid: string, serialized: string): void {
    if (typeof window !== 'undefined') window.localStorage.setItem(this.cacheKey(uid), serialized);
  }

  private queuePending(uid: string, serialized: string): void {
    if (typeof window !== 'undefined') window.localStorage.setItem(this.pendingKey(uid), serialized);
  }

  private removePending(uid: string): void {
    if (typeof window !== 'undefined') window.localStorage.removeItem(this.pendingKey(uid));
  }

  private hasPending(uid: string): boolean {
    return this.readPendingSerialized(uid) !== null;
  }

  private normalizeCompetitions(value: unknown): Competition[] {
    const entries = Array.isArray(value)
      ? value
      : value && typeof value === 'object'
        ? Object.values(value as Record<string, unknown>)
        : [];

    return entries
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .filter((entry) => typeof entry['id'] === 'string' && typeof entry['name'] === 'string' && typeof entry['date'] === 'string')
      .map((entry) => {
        const schedules = (Array.isArray(entry['schedules']) ? entry['schedules'] : []) as Competition['schedules'];
        const rawPair = entry['pairedCategories'];
        const pairedCategories = Array.isArray(rawPair)
          && rawPair.length === 2
          && rawPair.every((category) => category === 'SCALED' || category === 'MASTER' || category === 'INTER' || category === 'RX')
          ? [rawPair[0], rawPair[1]] as Competition['pairedCategories']
          : null;
        const optimizedSchedules = this.normalizeSavedSchedules(entry['optimizedSchedules'], entry['optimizedSchedule']);
        const rawActiveScheduleId = entry['activeScheduleId'];
        const activeScheduleId = typeof rawActiveScheduleId === 'string'
          && optimizedSchedules.some((schedule) => schedule.id === rawActiveScheduleId)
          ? rawActiveScheduleId
          : optimizedSchedules[0]?.id ?? null;

        return {
          id: entry['id'] as string,
          name: entry['name'] as string,
          date: entry['date'] as string,
          schedules,
          wods: this.normalizeWods(entry['wods'], schedules[0]?.id ?? ''),
          teams: Array.isArray(entry['teams']) ? entry['teams'] : [],
          pairedCategories,
          optimizedSchedules,
          activeScheduleId,
        };
      });
  }

  private normalizeWods(value: unknown, defaultScheduleId: string): Wod[] {
    if (!Array.isArray(value)) return [];

    return value
      .filter((wod): wod is Record<string, unknown> => Boolean(wod) && typeof wod === 'object')
      .map((wod) => ({
        ...wod,
        categoryInterval: Math.max(0, Number(wod['categoryInterval']) || 0),
        scheduleId: typeof wod['scheduleId'] === 'string' ? wod['scheduleId'] : defaultScheduleId,
      }) as Wod);
  }

  private normalizeSavedSchedules(value: unknown, legacyValue: unknown): SavedSchedule[] {
    const entries = Array.isArray(value)
      ? value
      : legacyValue && typeof legacyValue === 'object'
        ? [legacyValue]
        : [];

    return entries
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
      .filter((entry) => Array.isArray(entry['tracks']))
      .map((entry, index) => ({
        ...entry,
        id: typeof entry['id'] === 'string' && entry['id'].trim() ? entry['id'] : `saved-schedule-${index + 1}`,
        name: typeof entry['name'] === 'string' && entry['name'].trim() ? entry['name'] : `Horaire ${index + 1}`,
      })) as SavedSchedule[];
  }

  private cacheKey(uid: string): string {
    return `${CACHE_PREFIX}${uid}`;
  }

  private pendingKey(uid: string): string {
    return `${PENDING_PREFIX}${uid}`;
  }

  private static browserIsOnline(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine;
  }

  private browserIsOnline(): boolean {
    return FirebaseService.browserIsOnline();
  }

  private toAuthMessage(error: unknown): string {
    const code = (error as { code?: string })?.code ?? '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Courriel ou mot de passe incorrect.';
      case 'auth/email-already-in-use':
        return 'Un compte existe déjà avec ce courriel.';
      case 'auth/weak-password':
        return 'Le mot de passe doit contenir au moins 6 caractères.';
      case 'auth/invalid-email':
        return 'Nom d’utilisateur invalide.';
      case 'auth/too-many-requests':
        return 'Trop de tentatives. Réessayez dans quelques instants.';
      default:
        return 'Impossible de vous connecter pour le moment. Vérifiez votre connexion.';
    }
  }

  private toFirebaseEmail(identifier: string): string {
    const value = identifier.trim().toLowerCase();
    return value.includes('@') ? value : `${value}@wodflow.app`;
  }

  private toUsername(identifier: string): string {
    const value = identifier.trim();
    return value.includes('@') ? value.split('@')[0] : value;
  }
}
