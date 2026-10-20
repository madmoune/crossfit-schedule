import { Component, computed, effect, inject, signal, type OnDestroy, type WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseService } from './firebase.service';
import {
  BackendScheduleService,
  type BackendScheduleAlternative,
  type BackendSchedulePayload,
  type BackendScheduleResponse,
} from './backend-schedule.service';
import type * as XLSX from 'xlsx-js-style';

type XlsxModule = typeof import('xlsx-js-style');

export type Category = 'MASTER' | 'SCALED' | 'INTER' | 'RX';
export type Floor = 'main' | 'secondary';
export type CategoryPair = [Category, Category];

export interface Team {
  id: string;
  name: string;
  category: Category;
}

export interface ScheduleTrack {
  id: string;
  name: string;
  startTime: string;
  floor: Floor;
}

export interface Wod {
  id: string;
  name: string;
  duration: number;
  teamsPerWave: number;
  waveInterval: number;
  categoryInterval: number;
  setupAfter: number;
  scheduleId: string;
}

export interface Competition {
  id: string;
  name: string;
  date: string;
  schedules: ScheduleTrack[];
  wods: Wod[];
  teams: Team[];
  pairedCategories?: CategoryPair | null;
  optimizedSchedules?: SavedSchedule[];
  activeScheduleId?: string | null;
  /** Legacy field migrated by FirebaseService when older data is loaded. */
  optimizedSchedule?: GeneratedScheduleSnapshot | null;
}

interface ScheduledWave {
  number: number;
  start: number;
  end: number;
  teams: string[];
  lanes: ScheduledLane[];
  capacity: number;
  lanePositions?: number[];
}

interface ScheduledLane {
  lane: number;
  teamId: string;
}

interface GeneratedWod {
  wod: Wod;
  category: Category;
  categories: Category[];
  start: number;
  end: number;
  waves: ScheduledWave[];
}

export interface GeneratedTrack {
  schedule: ScheduleTrack;
  wods: GeneratedWod[];
  groups: GeneratedWodGroup[];
  columns: GeneratedWaveColumn[];
}

export interface GeneratedScheduleSnapshot {
  tracks: GeneratedTrack[];
  algorithmVersion?: number;
  generatedAt?: string;
  score?: string;
  cached?: boolean;
  minimumRestMinutes?: number;
  targetPauseLowerMinutes?: number;
  targetPauseUpperMinutes?: number;
}

export interface SavedSchedule extends GeneratedScheduleSnapshot {
  id: string;
  name: string;
}

interface GeneratedWaveColumn {
  generatedWod: GeneratedWod;
  wave: ScheduledWave;
}

interface GeneratedCategoryGroup {
  category: Category;
  categories: Category[];
  columns: GeneratedWaveColumn[];
}

interface GeneratedWodGroup {
  wod: Wod;
  categories: GeneratedCategoryGroup[];
  columns: GeneratedWaveColumn[];
}

interface TeamScheduleEntry {
  columnId: string;
  wod: Wod;
  schedule: ScheduleTrack;
  start: number;
  end: number;
  restAfter: number | null;
}

interface TeamScheduleSummary {
  team: Team;
  entries: TeamScheduleEntry[];
}

interface TeamScheduleColumn {
  id: string;
  wodId: string;
  name: string;
  schedule: ScheduleTrack;
  start: number;
  secondarySlot?: number;
}

interface TeamScheduleRow {
  team: Team;
  entries: Array<TeamScheduleEntry | null>;
}

interface TeamScheduleGroup {
  category: Category;
  rows: TeamScheduleRow[];
}

interface TeamScheduleTable {
  columns: TeamScheduleColumn[];
  groups: TeamScheduleGroup[];
}

interface ScheduleOptimizationScore {
  missingAssignments: number;
  finishOverWindow: number;
  finishDifference: number;
  overTwoHours: number;
  pauseExcess: number;
  pauseBalance: number;
}

interface AssignedInterval {
  start: number;
  end: number;
  floor: Floor;
}

interface WaveAddress {
  scheduleId: string;
  workoutId: string;
  category: Category;
  waveNumber: number;
}

interface DraggedTeam {
  address: WaveAddress;
  lane: number;
  teamId: string;
}

interface DeleteTarget {
  kind: 'schedule' | 'wod' | 'team' | 'teamCategory' | 'generatedSchedule' | 'categoryPair';
  id: string;
  name: string;
  count?: number;
}

const CATEGORY_ORDER: Category[] = ['SCALED', 'MASTER', 'INTER', 'RX'];
const LANE_ORDER = [5, 6, 4, 7, 3, 8, 2, 9, 1, 10];
const MAX_IDEAL_PAUSE = 120;
const SCHEDULE_ALGORITHM_VERSION = 8;
const STORAGE_KEY = 'crossfit-schedule.competitions';

const sampleTeams: Team[] = [
  { id: 'team-1', name: 'Balanced Chaos', category: 'SCALED' },
  { id: 'team-2', name: 'Les Crinqués', category: 'SCALED' },
  { id: 'team-3', name: 'BB Burst', category: 'SCALED' },
  { id: 'team-4', name: 'Impulsion', category: 'SCALED' },
  { id: 'team-5', name: 'Rest Day Team', category: 'SCALED' },
  { id: 'team-6', name: 'Les Arthrix', category: 'SCALED' },
  { id: 'team-7', name: 'Sept jambes et demies', category: 'SCALED' },
  { id: 'team-8', name: 'Les 4 P.A.K.S.', category: 'SCALED' },
  { id: 'team-9', name: 'RX dans notre coeur', category: 'SCALED' },
  { id: 'team-10', name: 'SQUADZILLA', category: 'SCALED' },
  { id: 'team-11', name: 'M — Unbroken since 1985', category: 'MASTER' },
  { id: 'team-12', name: 'M — Tenskills / Court Sur Pattes', category: 'MASTER' },
  { id: 'team-13', name: 'M — Rest Day Legends', category: 'MASTER' },
  { id: 'team-14', name: 'M — CrossFit Lac-Beauport', category: 'MASTER' },
  { id: 'team-15', name: 'M — Les Master du Nord', category: 'MASTER' },
  { id: 'team-16', name: 'M — Wod the heck', category: 'MASTER' },
  { id: 'team-17', name: 'M — Green Inferno 2.0', category: 'MASTER' },
  { id: 'team-18', name: 'M — Polaire Facile', category: 'MASTER' },
  { id: 'team-19', name: 'M — 819 Chaos Crew', category: 'MASTER' },
  { id: 'team-20', name: 'INTERgym', category: 'INTER' },
  { id: 'team-21', name: 'No water club', category: 'INTER' },
  { id: 'team-22', name: 'Les OuastiCounes', category: 'INTER' },
  { id: 'team-23', name: 'Les Telétubbies', category: 'INTER' },
  { id: 'team-24', name: 'IMP', category: 'INTER' },
  { id: 'team-25', name: 'Team Le Repère', category: 'INTER' },
  { id: 'team-26', name: 'WODCESTERSHIRE', category: 'INTER' },
  { id: 'team-27', name: 'Les microquettes', category: 'INTER' },
  { id: 'team-28', name: '3 cafés noir, un laid', category: 'INTER' },
  { id: 'team-29', name: 'HAS-BEEN & NEW BLOOD', category: 'INTER' },
  { id: 'team-30', name: 'Rip nos jambes', category: 'RX' },
  { id: 'team-31', name: 'Cougars and Kittens', category: 'RX' },
  { id: 'team-32', name: 'CrossFit Rive-Sud', category: 'RX' },
  { id: 'team-33', name: 'Les cassés musclés', category: 'RX' },
  { id: 'team-34', name: 'Clean daddies and snatch ladies', category: 'RX' },
  { id: 'team-35', name: 'BURNED OUT', category: 'RX' },
  { id: 'team-36', name: 'Snack Pack Lite', category: 'RX' },
  { id: 'team-37', name: 'TCP tonic', category: 'RX' },
  { id: 'team-38', name: 'All Gas No Brakes', category: 'RX' },
  { id: 'team-39', name: 'Pas fort, mais pas mort', category: 'RX' },
];

const sampleCompetition: Competition = {
  id: 'competition-demo',
  name: 'Northside Throwdown',
  date: '2026-08-15',
  schedules: [
    { id: 'schedule-main', name: 'Floor 1 · Principal', startTime: '09:00', floor: 'main' },
    { id: 'schedule-secondary', name: 'Floor 2 · Secondaire', startTime: '09:00', floor: 'secondary' },
  ],
  wods: [
    { id: 'wod-1', name: 'Engine & contrôle', duration: 30, teamsPerWave: 10, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-main' },
    { id: 'wod-2', name: 'Unbroken since 1985', duration: 30, teamsPerWave: 10, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-main' },
    { id: 'wod-3', name: 'No water club', duration: 30, teamsPerWave: 10, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-main' },
    { id: 'wod-4', name: 'Les plans B', duration: 30, teamsPerWave: 10, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-main' },
    { id: 'wod-5', name: 'The Girls & The Beasts', duration: 30, teamsPerWave: 10, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-main' },
    { id: 'wod-6', name: 'Rip nos jambes', duration: 30, teamsPerWave: 10, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-main' },
    { id: 'wod-7', name: 'All Gas No Brakes', duration: 30, teamsPerWave: 10, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-main' },
    { id: 'wod-8', name: 'Intervals', duration: 12, teamsPerWave: 5, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-secondary' },
    { id: 'wod-9', name: 'The sprint', duration: 12, teamsPerWave: 5, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-secondary' },
    { id: 'wod-10', name: 'Rest day', duration: 12, teamsPerWave: 5, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-secondary' },
    { id: 'wod-11', name: 'Master strength', duration: 12, teamsPerWave: 5, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-secondary' },
    { id: 'wod-12', name: 'Polaire facile', duration: 12, teamsPerWave: 5, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-secondary' },
    { id: 'wod-13', name: 'Finale Inter', duration: 12, teamsPerWave: 5, waveInterval: 5, categoryInterval: 10, setupAfter: 15, scheduleId: 'schedule-secondary' },
  ],
  teams: sampleTeams,
  pairedCategories: null,
};

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnDestroy {
  private readonly firebase = inject(FirebaseService);
  readonly categories: Category[] = ['SCALED', 'MASTER', 'INTER', 'RX'];
  readonly scheduleColumnsPerRow = 7;
  readonly competitions = this.firebase.competitions;
  readonly user = this.firebase.user;
  readonly authReady = this.firebase.authReady;
  readonly dataReady = this.firebase.dataReady;
  readonly authError = this.firebase.authError;
  readonly isOnline = this.firebase.isOnline;
  readonly syncState = this.firebase.syncState;
  readonly selectedCompetitionId = signal('');
  readonly competitionDialogOpen = signal(false);
  readonly editCompetitionDialogOpen = signal(false);
  readonly scheduleFormOpen = signal(false);
  readonly generatedScheduleFormOpen = signal(false);
  readonly wodFormOpen = signal(false);
  readonly deleteDialogOpen = signal(false);
  readonly deleteTarget = signal<DeleteTarget | null>(null);
  readonly teamSchedule = signal<TeamScheduleSummary | null>(null);
  readonly scheduleView = signal<'floors' | 'teams'>('floors');
  readonly editingScheduleId = signal<string | null>(null);
  readonly editingWodId = signal<string | null>(null);
  readonly teamEntryMode = signal<'count' | 'list' | 'manual'>('manual');
  readonly activeTeamCategory = signal<Category>('MASTER');
  readonly editingTeamId = signal<string | null>(null);
  readonly plannerCollapsed = signal(false);
  readonly teamsCollapsed = signal(false);
  readonly rulesCollapsed = signal(true);
  readonly categoryPairError = signal('');
  readonly profileMenuOpen = signal(false);
  readonly authMode = signal<'login' | 'register'>('login');
  readonly authBusy = signal(false);
  readonly generatedSchedule = signal<GeneratedScheduleSnapshot>({ tracks: [] });
  readonly scheduleDirty = signal(true);
  readonly optimizationBusy = signal(false);
  readonly optimizationError = signal('');
  readonly scheduleEditError = signal('');
  readonly scheduleExportError = signal('');
  readonly errorToast = signal('');
  readonly errorToastDurationMs = 5_000;
  readonly generationMenuOpen = signal(false);
  readonly draggedTeam = signal<DraggedTeam | null>(null);
  readonly draggedOverCell = signal<string | null>(null);
  readonly exportBusy = signal(false);
  readonly optimizationScenarioCount = 8;
  private readonly backendSchedule = inject(BackendScheduleService);
  private errorToastTimer: ReturnType<typeof setTimeout> | null = null;

  authUsername = '';
  authPassword = '';
  authPasswordConfirmation = '';
  scheduleError = signal('');

  readonly selectedCompetition = computed(() =>
    this.competitions().find((competition) => competition.id === this.selectedCompetitionId()),
  );

  readonly savedSchedules = computed(() => {
    const competition = this.selectedCompetition();
    return competition ? this.validSavedSchedules(competition) : [];
  });

  readonly activeSavedSchedule = computed(() => {
    const competition = this.selectedCompetition();
    return this.savedSchedules().find((schedule) => schedule.id === competition?.activeScheduleId);
  });

  readonly teamScheduleTable = computed<TeamScheduleTable>(() => {
    const competition = this.selectedCompetition();
    return competition
      ? this.buildTeamScheduleTable(competition, this.generatedSchedule().tracks)
      : { columns: [], groups: [] };
  });

  newCompetition = {
    name: '',
    date: new Date().toISOString().slice(0, 10),
  };

  editCompetition = {
    name: '',
    date: '',
  };

  draftSchedule = {
    name: '',
    startTime: '09:00',
    floor: 'main' as Floor,
  };

  draftWod = {
    name: '',
    duration: 12,
    teamsPerWave: 10,
    waveInterval: 5,
    categoryInterval: 10,
    setupAfter: 15,
    scheduleId: '',
  };

  draftTeam = {
    name: '',
    category: 'INTER' as Category,
  };

  teamCountDraft = {
    count: 1,
  };

  teamBulkCategory: Category = 'INTER';
  teamBulkInput = '';
  teamEditName = '';
  generatedScheduleNames: string[] = [];
  generatedScheduleCount = 1;
  readonly generationCounts = [1, 2, 3] as const;
  categoryPairDraft: CategoryPair = ['SCALED', 'MASTER'];

  constructor() {
    this.draftWod.scheduleId = this.selectedCompetition()?.schedules?.[0]?.id ?? '';

    effect(() => {
      const competitions = this.competitions();
      const selectedId = this.selectedCompetitionId();
      if (competitions.length === 0) {
        if (selectedId) this.selectedCompetitionId.set('');
      } else if (!competitions.some((competition) => competition.id === selectedId)) {
        const competition = competitions[0];
        this.selectedCompetitionId.set(competition.id);
        this.draftWod.scheduleId = competition.schedules?.[0]?.id ?? '';
        this.draftSchedule.floor = this.hasPrimarySchedule(competition) ? 'secondary' : 'main';
        this.setCategoryPairDraft(competition);
        this.restoreSavedSchedule(competition);
      }
    });

    effect(() => {
      const user = this.user();
      const competitions = this.competitions();
      if (user && this.dataReady()) void this.firebase.saveCompetitions(competitions);
    });
  }

  ngOnDestroy(): void {
    this.clearErrorToastTimer();
  }

  dismissErrorToast(): void {
    this.clearErrorToastTimer();
    this.errorToast.set('');
  }

  setAuthMode(mode: 'login' | 'register'): void {
    this.authMode.set(mode);
    this.firebase.authError.set('');
  }

  async submitAuth(): Promise<void> {
    const username = this.authUsername.trim();
    if (!username || !this.authPassword) {
      this.firebase.authError.set('Veuillez remplir votre nom d’utilisateur et votre mot de passe.');
      return;
    }
    if (this.authMode() === 'register' && this.authPassword !== this.authPasswordConfirmation) {
      this.firebase.authError.set('Les deux mots de passe doivent être identiques.');
      return;
    }

    this.authBusy.set(true);
    try {
      if (this.authMode() === 'login') await this.firebase.signIn(username, this.authPassword);
      else await this.firebase.register(username, this.authPassword);
    } catch {
      // The Firebase service exposes a user-friendly message to the template.
    } finally {
      this.authBusy.set(false);
    }
  }

  async signOut(): Promise<void> {
    this.profileMenuOpen.set(false);
    await this.firebase.signOut();
  }

  toggleProfileMenu(): void {
    this.profileMenuOpen.update((open) => !open);
  }

  openScheduleDialog(): void {
    const competition = this.selectedCompetition();
    this.scheduleError.set('');
    this.editingScheduleId.set(null);
    this.draftSchedule = {
      name: '',
      startTime: '09:00',
      floor: competition && this.hasPrimarySchedule(competition) ? 'secondary' : 'main',
    };
    this.scheduleFormOpen.set(true);
  }

  openEditSchedule(schedule: ScheduleTrack): void {
    this.editingScheduleId.set(schedule.id);
    this.scheduleError.set('');
    this.draftSchedule = {
      name: schedule.name,
      startTime: schedule.startTime,
      floor: schedule.floor,
    };
    this.scheduleFormOpen.set(true);
  }

  closeScheduleDialog(): void {
    this.scheduleFormOpen.set(false);
    this.scheduleError.set('');
    this.editingScheduleId.set(null);
  }

  openWodDialog(): void {
    const competition = this.selectedCompetition();
    if (!competition) return;
    this.editingWodId.set(null);
    this.draftWod = {
      name: '',
      duration: 12,
      teamsPerWave: 10,
      waveInterval: 5,
      categoryInterval: 10,
      setupAfter: 15,
      scheduleId: competition.schedules[0]?.id ?? '',
    };
    this.wodFormOpen.set(true);
  }

  openEditWod(wod: Wod): void {
    this.editingWodId.set(wod.id);
    this.draftWod = {
      name: wod.name,
      duration: wod.duration,
      teamsPerWave: wod.teamsPerWave,
      waveInterval: wod.waveInterval,
      categoryInterval: wod.categoryInterval,
      setupAfter: wod.setupAfter,
      scheduleId: wod.scheduleId,
    };
    this.wodFormOpen.set(true);
  }

  closeWodDialog(): void {
    this.wodFormOpen.set(false);
    this.editingWodId.set(null);
  }

  requestDeleteSchedule(schedule: ScheduleTrack): void {
    this.deleteTarget.set({ kind: 'schedule', id: schedule.id, name: schedule.name });
    this.deleteDialogOpen.set(true);
  }

  requestDeleteWod(wod: Wod): void {
    this.deleteTarget.set({ kind: 'wod', id: wod.id, name: wod.name });
    this.deleteDialogOpen.set(true);
  }

  requestDeleteTeam(team: Team): void {
    this.deleteTarget.set({ kind: 'team', id: team.id, name: team.name });
    this.deleteDialogOpen.set(true);
  }

  requestDeleteTeamCategory(category: Category): void {
    const competition = this.selectedCompetition();
    const count = competition ? this.teamCount(competition, category) : 0;
    if (!competition || count === 0) return;

    this.deleteTarget.set({
      kind: 'teamCategory',
      id: category,
      name: this.categoryLabel(category),
      count,
    });
    this.deleteDialogOpen.set(true);
  }

  requestDeleteGeneratedSchedule(schedule: SavedSchedule): void {
    this.deleteTarget.set({ kind: 'generatedSchedule', id: schedule.id, name: schedule.name });
    this.deleteDialogOpen.set(true);
  }

  requestDeleteCategoryPair(pair: CategoryPair): void {
    const competition = this.selectedCompetition();
    if (!competition) return;
    this.deleteTarget.set({
      kind: 'categoryPair',
      id: competition.id,
      name: `${this.categoryLabel(pair[0])} + ${this.categoryLabel(pair[1])}`,
    });
    this.deleteDialogOpen.set(true);
  }

  closeDeleteDialog(): void {
    this.deleteDialogOpen.set(false);
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target) return;

    if (target.kind === 'schedule') this.removeSchedule(target.id);
    else if (target.kind === 'wod') this.removeWod(target.id);
    else if (target.kind === 'team') this.removeTeam(target.id);
    else if (target.kind === 'teamCategory') this.removeTeamsByCategory(target.id as Category);
    else if (target.kind === 'generatedSchedule') this.removeGeneratedSchedule(target.id);
    else this.clearCategoryPair();

    this.closeDeleteDialog();
  }

  openEditCompetition(): void {
    const competition = this.selectedCompetition();
    if (!competition) return;
    this.editCompetition = { name: competition.name, date: competition.date };
    this.editCompetitionDialogOpen.set(true);
  }

  saveCompetitionDetails(): void {
    const name = this.editCompetition.name.trim();
    if (!name || !this.editCompetition.date) return;
    this.updateCompetition((current) => ({
      ...current,
      name,
      date: this.editCompetition.date,
    }));
    this.editCompetitionDialogOpen.set(false);
  }

  syncLabel(): string {
    if (!this.isOnline()) return 'Hors ligne · sauvegarde locale';
    switch (this.syncState()) {
      case 'loading': return 'Chargement Firebase';
      case 'saving': return 'Synchronisation…';
      case 'error': return 'Erreur de synchronisation';
      case 'saved': return 'Synchronisé Firebase';
      default: return 'En attente';
    }
  }

  avatarLabel(): string {
    const label = this.user()?.displayName ?? this.user()?.email ?? 'W';
    return label.slice(0, 2).toUpperCase();
  }

  userLabel(): string {
    return this.user()?.displayName ?? this.user()?.email ?? '';
  }

  addCompetition(): void {
    const name = this.newCompetition.name.trim();
    if (!name || !this.newCompetition.date) return;

    const competition: Competition = {
      id: this.makeId('competition'),
      name,
      date: this.newCompetition.date,
      schedules: [],
      wods: [],
      teams: [],
      pairedCategories: null,
      optimizedSchedules: [],
      activeScheduleId: null,
    };

    this.competitions.update((competitions) => [...competitions, competition]);
    this.selectedCompetitionId.set(competition.id);
    this.generatedSchedule.set({ tracks: [] });
    this.scheduleDirty.set(true);
    this.optimizationError.set('');
    this.teamSchedule.set(null);
    this.newCompetition = { name: '', date: new Date().toISOString().slice(0, 10) };
    this.competitionDialogOpen.set(false);
  }

  selectCompetition(id: string): void {
    this.selectedCompetitionId.set(id);
    this.teamSchedule.set(null);
    const competition = this.selectedCompetition();
    this.draftWod.scheduleId = competition?.schedules[0]?.id ?? '';
    this.draftSchedule.floor = competition && this.hasPrimarySchedule(competition) ? 'secondary' : 'main';
    this.setCategoryPairDraft(competition);
    if (competition) this.restoreSavedSchedule(competition);
  }

  saveSchedule(): void {
    const competition = this.selectedCompetition();
    const name = this.draftSchedule.name.trim();
    const editingId = this.editingScheduleId();
    this.scheduleError.set('');
    if (!competition || !name) return;

    const anotherPrimaryExists = competition.schedules.some(
      (schedule) => schedule.floor === 'main' && schedule.id !== editingId,
    );
    if (this.draftSchedule.floor === 'main' && anotherPrimaryExists) {
      this.scheduleError.set('Un seul horaire principal est permis.');
      return;
    }

    if (editingId) {
      this.updateCompetition((current) => ({
        ...current,
        schedules: current.schedules.map((schedule) =>
          schedule.id === editingId
            ? { ...schedule, name, startTime: this.draftSchedule.startTime, floor: this.draftSchedule.floor }
            : schedule,
        ),
      }));
      this.closeScheduleDialog();
      return;
    }

    const schedule: ScheduleTrack = {
      id: this.makeId('schedule'),
      name,
      startTime: this.draftSchedule.startTime,
      floor: this.draftSchedule.floor,
    };

    this.updateCompetition((current) => ({
      ...current,
      schedules: [...current.schedules, schedule],
    }));
    this.draftWod.scheduleId ||= schedule.id;
    this.draftSchedule = {
      name: '',
      startTime: '09:00',
      floor: schedule.floor === 'main' || this.hasPrimarySchedule(competition) ? 'secondary' : 'main',
    };
    this.closeScheduleDialog();
  }

  mainScheduleOptionDisabled(): boolean {
    const competition = this.selectedCompetition();
    const editingId = this.editingScheduleId();
    return competition?.schedules.some((schedule) => schedule.floor === 'main' && schedule.id !== editingId) ?? false;
  }

  removeSchedule(scheduleId: string): void {
    this.updateCompetition((current) => {
      const schedules = current.schedules.filter((schedule) => schedule.id !== scheduleId);
      const replacementScheduleId = schedules[0]?.id;

      return {
        ...current,
        schedules,
        wods: current.wods.map((wod) =>
          wod.scheduleId === scheduleId && replacementScheduleId
            ? { ...wod, scheduleId: replacementScheduleId }
            : wod,
        ),
      };
    });
    this.draftWod.scheduleId = this.selectedCompetition()?.schedules[0]?.id ?? '';
    this.draftSchedule.floor = this.selectedCompetition()?.schedules.some((schedule) => schedule.floor === 'main') ? 'secondary' : 'main';
  }

  hasPrimarySchedule(competition: Competition): boolean {
    return competition.schedules.some((schedule) => schedule.floor === 'main');
  }

  hasSelectedPrimarySchedule(): boolean {
    const competition = this.selectedCompetition();
    return competition ? this.hasPrimarySchedule(competition) : false;
  }

  saveWod(): void {
    const competition = this.selectedCompetition();
    const name = this.draftWod.name.trim();
    const scheduleId = this.draftWod.scheduleId;
    const editingId = this.editingWodId();
    if (!competition || !name || !scheduleId) return;

    const values = {
      name,
      duration: Math.max(1, Number(this.draftWod.duration)),
      teamsPerWave: Math.max(1, Number(this.draftWod.teamsPerWave)),
      waveInterval: Math.max(0, Number(this.draftWod.waveInterval)),
      categoryInterval: Math.max(0, Number(this.draftWod.categoryInterval)),
      setupAfter: Math.max(0, Number(this.draftWod.setupAfter)),
      scheduleId,
    };

    if (editingId) {
      this.updateCompetition((current) => ({
        ...current,
        wods: current.wods.map((wod) => wod.id === editingId ? { ...wod, ...values } : wod),
      }));
      this.closeWodDialog();
      return;
    }

    const wod: Wod = {
      id: this.makeId('wod'),
      ...values,
    };

    this.updateCompetition((current) => ({ ...current, wods: [...current.wods, wod] }));
    this.draftWod = {
      name: '',
      duration: 12,
      teamsPerWave: 10,
      waveInterval: 5,
      categoryInterval: 10,
      setupAfter: 15,
      scheduleId,
    };
    this.closeWodDialog();
  }

  removeWod(wodId: string): void {
    this.updateCompetition((current) => ({
      ...current,
      wods: current.wods.filter((wod) => wod.id !== wodId),
    }));
  }

  addTeam(): void {
    const name = this.draftTeam.name.trim();
    if (!this.selectedCompetition() || !name) return;

    const team: Team = {
      id: this.makeId('team'),
      name,
      category: this.draftTeam.category,
    };
    this.updateCompetition((current) => ({ ...current, teams: [...current.teams, team] }));
    this.activeTeamCategory.set(this.draftTeam.category);
    this.draftTeam = { name: '', category: this.draftTeam.category };
  }

  openEditTeam(team: Team): void {
    this.editingTeamId.set(team.id);
    this.teamEditName = team.name;
  }

  closeEditTeam(): void {
    this.editingTeamId.set(null);
    this.teamEditName = '';
  }

  saveTeamName(): void {
    const name = this.teamEditName.trim();
    const editingId = this.editingTeamId();
    if (!editingId || !name) return;

    this.updateCompetition((current) => ({
      ...current,
      teams: current.teams.map((team) => team.id === editingId ? { ...team, name } : team),
    }));
    this.closeEditTeam();
  }

  addTeamsByCount(): void {
    const competition = this.selectedCompetition();
    const count = Math.max(1, Math.floor(Number(this.teamCountDraft.count) || 0));
    const category = this.activeTeamCategory();
    if (!competition) return;

    const startingNumber = competition.teams.filter((team) => team.category === category).length + 1;
    const teams: Team[] = Array.from({ length: count }, (_, index) => ({
      id: this.makeId('team'),
      name: `${this.categoryLabel(category)} ${this.formatIndex(startingNumber + index)}`,
      category,
    }));

    this.updateCompetition((current) => ({ ...current, teams: [...current.teams, ...teams] }));
    this.activeTeamCategory.set(category);
    this.teamCountDraft.count = 1;
  }

  addTeamList(): void {
    if (this.addTeamNames(this.teamBulkInput, this.teamBulkCategory)) this.teamBulkInput = '';
  }

  pasteTeamList(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!text.trim()) return;
    event.preventDefault();
    this.addTeamNames(text, this.teamBulkCategory);
    this.teamBulkInput = '';
  }

  teamsForCategory(competition: Competition, category: Category): Team[] {
    return competition.teams.filter((team) => team.category === category);
  }

  private addTeamNames(value: string, category: Category): number {
    const competition = this.selectedCompetition();
    const names = value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
    if (!competition || names.length === 0) return 0;

    const teams = names.map((name) => ({ id: this.makeId('team'), name, category }));
    this.updateCompetition((current) => ({ ...current, teams: [...current.teams, ...teams] }));
    this.activeTeamCategory.set(category);
    return teams.length;
  }

  removeTeam(teamId: string): void {
    this.updateCompetition((current) => ({
      ...current,
      teams: current.teams.filter((team) => team.id !== teamId),
    }));
  }

  removeTeamsByCategory(category: Category): void {
    this.updateCompetition((current) => ({
      ...current,
      teams: current.teams.filter((team) => team.category !== category),
    }));
  }

  saveCategoryPair(): void {
    const competition = this.selectedCompetition();
    const [first, second] = this.categoryPairDraft;
    if (!competition) return;
    if (first === second) {
      this.categoryPairError.set('Choisissez deux catégories différentes.');
      return;
    }

    this.updateCompetition((current) => ({
      ...current,
      pairedCategories: [first, second],
    }));
    this.categoryPairError.set('');
  }

  clearCategoryPair(): void {
    this.updateCompetition((current) => ({ ...current, pairedCategories: null }));
    this.categoryPairError.set('');
  }

  scrollToSchedule(): void {
    const schedule = document.getElementById('generated-schedule');
    schedule?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  openGeneratedScheduleDialog(count = this.generatedScheduleCount): void {
    const competition = this.selectedCompetition();
    if (!competition || this.optimizationBusy()) return;

    this.generatedScheduleCount = count;
    this.generationMenuOpen.set(false);
    this.generatedScheduleNames = this.nextGeneratedScheduleNames(competition, count);
    this.generatedScheduleFormOpen.set(true);
  }

  toggleGenerationMenu(): void {
    if (this.optimizationBusy()) return;
    this.generationMenuOpen.update((open) => !open);
  }

  closeGeneratedScheduleDialog(): void {
    this.generatedScheduleFormOpen.set(false);
    this.generatedScheduleNames = [];
  }

  generatedScheduleNamesValid(): boolean {
    return this.generatedScheduleNames.length === this.generatedScheduleCount
      && this.generatedScheduleNames.every((name) => name.trim().length > 0);
  }

  async generateSchedule(): Promise<void> {
    const competition = this.selectedCompetition();
    const requestedCount = this.generatedScheduleCount;
    const names = this.generatedScheduleNames
      .slice(0, requestedCount)
      .map((name) => name.trim());
    if (
      !competition
      || names.length !== requestedCount
      || names.some((name) => !name)
      || this.optimizationBusy()
    ) return;

    this.closeGeneratedScheduleDialog();
    this.dismissErrorToast();
    this.optimizationBusy.set(true);
    this.optimizationError.set('');
    this.scheduleEditError.set('');
    this.scheduleExportError.set('');
    try {
      const response = await this.backendSchedule.optimize(competition, requestedCount);
      const alternatives: Array<BackendScheduleResponse | BackendScheduleAlternative> = response.alternatives?.length
        ? response.alternatives
        : [response];
      if (alternatives.length < requestedCount) {
        throw new Error(
          `Le backend n'a retourné que ${alternatives.length} horaire${alternatives.length === 1 ? '' : 's'} `
          + `sur les ${requestedCount} demandés. Aucun horaire n'a été sauvegardé.`,
        );
      }
      const savedSchedules: SavedSchedule[] = alternatives
        .slice(0, requestedCount)
        .map((alternative, index) => ({
          ...this.mapBackendSchedule(competition, alternative),
          id: this.makeId('generated-schedule'),
          name: names[index],
        }));
      this.competitions.update((competitions) => competitions.map((candidate) =>
        candidate.id === competition.id
          ? {
              ...candidate,
              optimizedSchedules: [...(candidate.optimizedSchedules ?? []), ...savedSchedules],
              activeScheduleId: savedSchedules[0].id,
              optimizedSchedule: null,
            }
          : candidate,
      ));
      this.generatedSchedule.set(savedSchedules[0]);
      this.scheduleDirty.set(false);
      this.teamSchedule.set(null);
      this.scrollToSchedule();
    } catch (error) {
      this.reportTemporaryError(this.optimizationError, this.optimizationErrorMessage(error));
    } finally {
      this.optimizationBusy.set(false);
    }
  }

  selectGeneratedSchedule(scheduleId: string): void {
    const competition = this.selectedCompetition();
    const saved = competition
      ? this.validSavedSchedules(competition).find((schedule) => schedule.id === scheduleId)
      : undefined;
    if (!competition || !saved) return;

    this.competitions.update((competitions) => competitions.map((candidate) =>
      candidate.id === competition.id ? { ...candidate, activeScheduleId: saved.id } : candidate,
    ));
    this.generatedSchedule.set(saved);
    this.scheduleDirty.set(false);
    this.optimizationError.set('');
    this.scheduleEditError.set('');
    this.scheduleExportError.set('');
    this.teamSchedule.set(null);
  }

  removeGeneratedSchedule(scheduleId: string): void {
    const competition = this.selectedCompetition();
    if (!competition) return;

    const remaining = (competition.optimizedSchedules ?? []).filter((schedule) => schedule.id !== scheduleId);
    const validRemaining = this.validSavedSchedules({ ...competition, optimizedSchedules: remaining });
    const next = validRemaining.find((schedule) => schedule.id === competition.activeScheduleId) ?? validRemaining[0];

    this.competitions.update((competitions) => competitions.map((candidate) =>
      candidate.id === competition.id
        ? { ...candidate, optimizedSchedules: remaining, activeScheduleId: next?.id ?? null, optimizedSchedule: null }
        : candidate,
    ));
    this.generatedSchedule.set(next ?? { tracks: [] });
    this.scheduleDirty.set(!next);
    this.optimizationError.set('');
    this.scheduleEditError.set('');
    this.scheduleExportError.set('');
    this.teamSchedule.set(null);
  }

  async exportScheduleToExcel(): Promise<void> {
    const competition = this.selectedCompetition();
    const saved = this.activeSavedSchedule();
    if (!competition || !saved || saved.tracks.length === 0) return;

    this.dismissErrorToast();
    this.scheduleExportError.set('');
    this.exportBusy.set(true);
    try {
      const xlsx = await import('xlsx-js-style');
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, this.buildExcelSummarySheet(xlsx, competition, saved), 'Résumé');

      const usedSheetNames = new Set(['Résumé']);
      saved.tracks.forEach((track, index) => {
        const sheetName = this.excelFloorSheetName(track, index, usedSheetNames);
        usedSheetNames.add(sheetName);
        xlsx.utils.book_append_sheet(workbook, this.buildExcelFloorSheet(xlsx, competition, saved, track), sheetName);
      });

      const filename = `${this.excelSafeName(competition.name)}-${this.excelSafeName(saved.name)}-${competition.date}.xlsx`;
      xlsx.writeFile(workbook, filename, { bookType: 'xlsx', cellStyles: true });
    } catch {
      this.reportTemporaryError(this.scheduleExportError, 'Impossible de créer le fichier Excel.');
    } finally {
      this.exportBusy.set(false);
    }
  }

  private buildExcelSummarySheet(xlsx: XlsxModule, competition: Competition, saved: SavedSchedule): XLSX.WorkSheet {
    const titleStyle = this.excelStyle({ fill: '2F3C34', fontColor: 'FFFFFF', fontSize: 14, bold: true });
    const labelStyle = this.excelStyle({ fill: 'F0F4ED', fontColor: '526258', bold: true, horizontal: 'left' });
    const valueStyle = this.excelStyle({ fill: 'FFFFFF', fontColor: '34443A', horizontal: 'left' });
    const rows: XLSX.CellObject[][] = [
      [this.excelCell('Résumé de l’horaire', titleStyle), this.excelBlank(titleStyle)],
      [this.excelCell('Compétition', labelStyle), this.excelCell(competition.name, valueStyle)],
      [this.excelCell('Date', labelStyle), this.excelCell(this.formatDate(competition.date), valueStyle)],
      [this.excelCell('Horaire actif', labelStyle), this.excelCell(saved.name, valueStyle)],
      [this.excelCell('Généré le', labelStyle), this.excelCell(saved.generatedAt ? this.formatSavedAt(saved.generatedAt) : '', valueStyle)],
      [this.excelCell('Score Timefold', labelStyle), this.excelCell(saved.score ?? '', valueStyle)],
      [this.excelCell('Équipes', labelStyle), this.excelCell(competition.teams.length, valueStyle)],
      [this.excelCell('WODs', labelStyle), this.excelCell(competition.wods.length, valueStyle)],
      [this.excelCell('Pause minimale floor 2 (min)', labelStyle), this.excelCell(saved.minimumRestMinutes ?? 60, valueStyle)],
      [this.excelCell('Feuilles détaillées', labelStyle), this.excelCell('Une feuille par floor, organisée comme l’affichage « Par floor ».', valueStyle)],
    ];
    const worksheet = this.excelWorksheetFromRows(xlsx, rows, [24, 58], [{ hpt: 24 }, ...Array.from({ length: rows.length - 1 }, () => ({ hpt: 20 }))]);
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    return worksheet;
  }

  private buildExcelFloorSheet(
    _xlsx: XlsxModule,
    competition: Competition,
    _saved: SavedSchedule,
    track: GeneratedTrack,
  ): XLSX.WorkSheet {
    const groups = track.groups.length ? track.groups : this.groupGeneratedWods(track.wods);
    const chunks = groups.flatMap((group) => this.scheduleRows(group.columns));
    const maxWaveCount = Math.max(1, ...chunks.map((columns) => columns.length));
    const maxColumns = maxWaveCount * 2;
    const rows: XLSX.CellObject[][] = [];
    const rowHeights: XLSX.RowInfo[] = [];
    const merges: XLSX.Range[] = [];
    const blankStyle = this.excelStyle({ fill: 'FFFFFF', borderColor: 'FFFFFF' });
    const floorTitleStyle = this.excelStyle({ fill: '2F3C34', fontColor: 'FFFFFF', fontSize: 14, bold: true });
    const floorMetaStyle = this.excelStyle({ fill: 'EDF5E9', fontColor: '526258', fontSize: 10, bold: true });
    const wodTitleStyle = this.excelStyle({ fill: 'FFFFFF', fontColor: '1E2922', fontSize: 11, bold: true });
    const waveHeaderStyle = this.excelStyle({ fill: 'FFFFFF', fontColor: '1E2922', fontSize: 9, bold: true });

    const addRow = (cells: XLSX.CellObject[], height: number): number => {
      const rowIndex = rows.length;
      rows.push(this.padExcelRow(cells, maxColumns, blankStyle));
      rowHeights.push({ hpt: height });
      return rowIndex;
    };
    const mergeBlock = (row: number, width: number): void => {
      merges.push({ s: { r: row, c: 0 }, e: { r: row, c: Math.max(0, width - 1) } });
    };

    const floorTitleRow = addRow([
      this.excelCell(`${this.floorLabel(track.schedule.floor)} · ${track.schedule.name}`, floorTitleStyle),
      ...Array.from({ length: maxColumns - 1 }, () => this.excelBlank(floorTitleStyle)),
    ], 27);
    mergeBlock(floorTitleRow, maxColumns);
    const metaRow = addRow([
      this.excelCell(`${competition.name} · ${this.formatDate(competition.date)} · Début ${track.schedule.startTime}`, floorMetaStyle),
      ...Array.from({ length: maxColumns - 1 }, () => this.excelBlank(floorMetaStyle)),
    ], 22);
    mergeBlock(metaRow, maxColumns);
    addRow(Array.from({ length: maxColumns }, () => this.excelBlank(blankStyle)), 7);

    if (groups.length === 0) {
      const emptyStyle = this.excelStyle({ fill: 'FFFFFF', fontColor: '89948C', fontSize: 10 });
      const emptyRow = addRow([
        this.excelCell('Aucun WOD dans cet horaire.', emptyStyle),
        ...Array.from({ length: maxColumns - 1 }, () => this.excelBlank(emptyStyle)),
      ], 24);
      mergeBlock(emptyRow, maxColumns);
    }

    groups.forEach((group) => {
      this.scheduleRows(group.columns).forEach((columns, chunkIndex) => {
        const blockWidth = columns.length * 2;
        if (chunkIndex === 0) {
          const wodTitleRow = addRow([
            this.excelCell(group.wod.name, wodTitleStyle),
            ...Array.from({ length: blockWidth - 1 }, () => this.excelBlank(wodTitleStyle)),
          ], 23);
          mergeBlock(wodTitleRow, blockWidth);
        }

        const categoryCells: XLSX.CellObject[] = [];
        const categoryRowGroups = this.categoryGroupsForColumns(group, columns);
        let categoryOffset = 0;
        categoryRowGroups.forEach((categoryGroup) => {
          const categoryWidth = categoryGroup.columns.length * 2;
          const style = this.excelStyle({
            fill: categoryGroup.categories.length > 1 ? 'F4F0D8' : this.excelCategoryFill(categoryGroup.category),
            fontColor: '1E2922',
            fontSize: 9,
            bold: true,
          });
          categoryCells.push(this.excelCell(this.categoryLabels(categoryGroup.categories), style));
          categoryCells.push(...Array.from({ length: categoryWidth - 1 }, () => this.excelBlank(style)));
          const categoryRow = rows.length;
          merges.push({ s: { r: categoryRow, c: categoryOffset }, e: { r: categoryRow, c: categoryOffset + categoryWidth - 1 } });
          categoryOffset += categoryWidth;
        });
        while (categoryOffset < blockWidth) {
          categoryCells.push(this.excelBlank(blankStyle));
          categoryOffset += 1;
        }
        addRow(categoryCells, 22);

        const waveCells: XLSX.CellObject[] = [];
        columns.forEach((column) => {
          waveCells.push(this.excelCell(`Wave ${column.wave.number}\n${this.formatTimeRange(column.wave.start, column.wave.end)}`, waveHeaderStyle));
          waveCells.push(this.excelBlank(waveHeaderStyle));
          const waveHeaderRow = rows.length;
          const waveOffset = waveCells.length - 2;
          merges.push({ s: { r: waveHeaderRow, c: waveOffset }, e: { r: waveHeaderRow, c: waveOffset + 1 } });
        });
        addRow(waveCells, 30);

        for (const laneNumber of this.laneNumbersForWave(columns[0], track.schedule.floor)) {
          const laneCells: XLSX.CellObject[] = [];
          columns.forEach((column) => {
            const assignedLane = column.wave.lanes.find((lane) => lane.lane === laneNumber);
            const team = assignedLane ? competition.teams.find((candidate) => candidate.id === assignedLane.teamId) : undefined;
            const fill = team
              ? this.excelCategoryFill(team.category)
              : column.generatedWod.categories.length > 1
                ? 'F4F0D8'
                : this.excelCategoryFill(column.generatedWod.category);
            const laneStyle = this.excelStyle({ fill, fontColor: '829085', fontSize: 8 });
            const teamStyle = this.excelStyle({ fill, fontColor: '36453B', fontSize: 9, italic: !team });
            laneCells.push(this.excelCell(laneNumber, laneStyle));
            laneCells.push(this.excelCell(team?.name ?? '', teamStyle));
          });
          addRow(laneCells, 20);
        }
        addRow(Array.from({ length: maxColumns }, () => this.excelBlank(blankStyle)), 7);
      });
    });

    const worksheet = this.excelWorksheetFromRows(
      _xlsx,
      rows,
      Array.from({ length: maxColumns }, (_, index) => index % 2 === 0 ? 5 : 25),
      rowHeights,
    );
    worksheet['!merges'] = merges;
    return worksheet;
  }

  private excelFloorSheetName(track: GeneratedTrack, index: number, usedNames: Set<string>): string {
    const base = this.floorLabel(track.schedule.floor);
    let name = base.slice(0, 31);
    let suffix = 2;
    while (usedNames.has(name)) {
      const suffixText = ` ${suffix}`;
      name = `${base.slice(0, 31 - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    return name || `Floor ${index + 1}`;
  }

  private excelWorksheetFromRows(
    xlsx: XlsxModule,
    rows: XLSX.CellObject[][],
    columnWidths: number[],
    rowHeights: XLSX.RowInfo[],
  ): XLSX.WorkSheet {
    const worksheet = xlsx.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = columnWidths.map((wch) => ({ wch }));
    worksheet['!rows'] = rowHeights;
    return worksheet;
  }

  private padExcelRow(row: XLSX.CellObject[], width: number, blankStyle: XLSX.CellStyle): XLSX.CellObject[] {
    return [
      ...row,
      ...Array.from({ length: Math.max(0, width - row.length) }, () => this.excelBlank(blankStyle)),
    ];
  }

  private excelCell(value: string | number, style: XLSX.CellStyle): XLSX.CellObject {
    return { v: value, t: typeof value === 'number' ? 'n' : 's', s: style };
  }

  private excelBlank(style: XLSX.CellStyle): XLSX.CellObject {
    return this.excelCell('', style);
  }

  private excelStyle(options: {
    fill?: string;
    fontColor?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    horizontal?: 'left' | 'center' | 'right';
    borderColor?: string;
  }): XLSX.CellStyle {
    const borderColor = { rgb: options.borderColor ?? '222222' };
    const edge = { style: 'thin' as const, color: borderColor };
    return {
      fill: { patternType: 'solid', fgColor: { rgb: options.fill ?? 'FFFFFF' } },
      font: {
        name: 'Calibri',
        sz: options.fontSize ?? 9,
        color: { rgb: options.fontColor ?? '1E2922' },
        ...(options.bold ? { bold: true } : {}),
        ...(options.italic ? { italic: true } : {}),
      },
      alignment: {
        horizontal: options.horizontal ?? 'center',
        vertical: 'center',
        wrapText: true,
      },
      border: { top: edge, right: edge, bottom: edge, left: edge },
    };
  }

  private excelCategoryFill(category: Category): string {
    return {
      SCALED: 'E0EFD7',
      MASTER: 'E0E4F4',
      INTER: 'F9EFC7',
      RX: 'F8DFD3',
    }[category];
  }

  private excelSafeName(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'horaire';
  }

  startTeamDrag(
    event: DragEvent,
    track: GeneratedTrack,
    column: GeneratedWaveColumn,
    lane: number,
    teamId: string,
  ): void {
    if (!this.activeSavedSchedule() || this.optimizationBusy()) {
      event.preventDefault();
      return;
    }

    this.dismissErrorToast();
    this.scheduleEditError.set('');
    this.draggedOverCell.set(null);
    this.draggedTeam.set({
      address: this.waveAddress(track.schedule.id, column),
      lane,
      teamId,
    });
    event.dataTransfer?.setData('text/plain', teamId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  endTeamDrag(): void {
    this.draggedTeam.set(null);
    this.draggedOverCell.set(null);
  }

  allowTeamDrop(event: DragEvent, track: GeneratedTrack, column: GeneratedWaveColumn, lane: number): void {
    if (!this.draggedTeam()) return;
    event.preventDefault();
    this.draggedOverCell.set(this.waveCellKey(this.waveAddress(track.schedule.id, column), lane));
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  isDragTarget(track: GeneratedTrack, column: GeneratedWaveColumn, lane: number): boolean {
    const dragged = this.draggedTeam();
    if (!dragged) return false;
    return this.draggedOverCell() === this.waveCellKey(this.waveAddress(track.schedule.id, column), lane)
      && !this.sameWaveCell(dragged.address, dragged.lane, this.waveAddress(track.schedule.id, column), lane);
  }

  isDraggedSource(track: GeneratedTrack, column: GeneratedWaveColumn, lane: number): boolean {
    const dragged = this.draggedTeam();
    if (!dragged) return false;
    return this.sameWaveCell(
      dragged.address,
      dragged.lane,
      this.waveAddress(track.schedule.id, column),
      lane,
    );
  }

  dropTeam(event: DragEvent, track: GeneratedTrack, column: GeneratedWaveColumn, lane: number): void {
    event.preventDefault();
    const dragged = this.draggedTeam();
    this.draggedTeam.set(null);
    this.draggedOverCell.set(null);
    if (!dragged) return;

    const targetAddress = this.waveAddress(track.schedule.id, column);
    if (this.sameWaveCell(dragged.address, dragged.lane, targetAddress, lane)) return;

    const competition = this.selectedCompetition();
    const current = this.generatedSchedule();
    if (!competition) return;

    const candidateTracks = this.cloneGeneratedTracks(current.tracks);
    const sourceLocation = this.findWaveLocation(candidateTracks, dragged.address);
    const targetLocation = this.findWaveLocation(candidateTracks, targetAddress);
    if (!sourceLocation || !targetLocation) {
      this.reportTemporaryError(
        this.scheduleEditError,
        'Déplacement impossible : la vague n’est plus disponible.',
      );
      return;
    }

    const sourceWave = candidateTracks[sourceLocation.trackIndex].wods[sourceLocation.generatedWodIndex].waves[sourceLocation.waveIndex];
    const targetWave = candidateTracks[targetLocation.trackIndex].wods[targetLocation.generatedWodIndex].waves[targetLocation.waveIndex];
    const sourceTeam = sourceWave.lanes.find((candidate) => candidate.lane === dragged.lane)?.teamId;
    const targetTeam = targetWave.lanes.find((candidate) => candidate.lane === lane)?.teamId ?? null;
    if (sourceTeam !== dragged.teamId) {
      this.reportTemporaryError(
        this.scheduleEditError,
        'Déplacement impossible : l’équipe source n’est plus à cette position.',
      );
      return;
    }

    this.setLaneTeam(sourceWave, dragged.lane, targetTeam);
    this.setLaneTeam(targetWave, lane, sourceTeam);

    const minimumRestMinutes = Math.max(60, current.minimumRestMinutes ?? 60);
    const validationError = this.validateManualSchedule(candidateTracks, competition, minimumRestMinutes);
    if (validationError) {
      this.reportTemporaryError(this.scheduleEditError, validationError);
      return;
    }

    this.persistManualSchedule(candidateTracks);
  }

  private persistManualSchedule(tracks: GeneratedTrack[]): void {
    const competition = this.selectedCompetition();
    const activeId = competition?.activeScheduleId;
    const saved = activeId
      ? this.validSavedSchedules(competition).find((schedule) => schedule.id === activeId)
      : undefined;
    if (!competition || !saved) {
      this.reportTemporaryError(
        this.scheduleEditError,
        'Enregistrez d’abord l’horaire généré avant de le modifier.',
      );
      return;
    }

    const updated: SavedSchedule = {
      ...this.generatedSchedule(),
      id: saved.id,
      name: saved.name,
      tracks,
    };
    this.generatedSchedule.set(updated);
    this.competitions.update((competitions) => competitions.map((candidate) =>
      candidate.id === competition.id
        ? {
            ...candidate,
            activeScheduleId: saved.id,
            optimizedSchedules: (candidate.optimizedSchedules ?? []).map((schedule) =>
              schedule.id === saved.id ? updated : schedule,
            ),
            optimizedSchedule: null,
          }
        : candidate,
    ));
    this.scheduleDirty.set(false);
    this.scheduleEditError.set('');
    this.teamSchedule.set(null);
  }

  private validateManualSchedule(tracks: GeneratedTrack[], competition: Competition, minimumRestMinutes: number): string | null {
    const intervalsByTeam = new Map<string, Array<{ start: number; end: number; floor: Floor }>>();

    for (const track of tracks) {
      for (const generatedWod of track.wods) {
        for (const wave of generatedWod.waves) {
          for (const lane of wave.lanes) {
            const intervals = intervalsByTeam.get(lane.teamId) ?? [];
            intervals.push({ start: wave.start, end: wave.end, floor: track.schedule.floor });
            intervalsByTeam.set(lane.teamId, intervals);
          }
        }
      }
    }

    for (const [teamId, teamIntervals] of intervalsByTeam) {
      const teamName = competition.teams.find((team) => team.id === teamId)?.name ?? teamId;
      const intervals = [...teamIntervals].sort((first, second) => first.start - second.start);
      for (let index = 0; index < intervals.length - 1; index += 1) {
        const first = intervals[index];
        const second = intervals[index + 1];
        const rest = second.start - first.end;
        if ((first.floor === 'secondary' || second.floor === 'secondary') && rest < minimumRestMinutes) {
          return `Déplacement refusé : ${teamName} doit garder au moins ${minimumRestMinutes} minutes autour d’un WOD du floor 2.`;
        }
      }
    }

    return null;
  }

  private waveAddress(scheduleId: string, column: GeneratedWaveColumn): WaveAddress {
    return {
      scheduleId,
      workoutId: column.generatedWod.wod.id,
      category: column.generatedWod.category,
      waveNumber: column.wave.number,
    };
  }

  private sameWaveCell(first: WaveAddress, firstLane: number, second: WaveAddress, secondLane: number): boolean {
    return first.scheduleId === second.scheduleId
      && first.workoutId === second.workoutId
      && first.category === second.category
      && first.waveNumber === second.waveNumber
      && firstLane === secondLane;
  }

  private waveCellKey(address: WaveAddress, lane: number): string {
    return `${address.scheduleId}|${address.workoutId}|${address.category}|${address.waveNumber}|${lane}`;
  }

  private cloneGeneratedTracks(tracks: GeneratedTrack[]): GeneratedTrack[] {
    return tracks.map((track) => {
      const wods = track.wods.map((generatedWod) => ({
        ...generatedWod,
        waves: generatedWod.waves.map((wave) => ({
          ...wave,
          teams: [...wave.teams],
          lanes: wave.lanes.map((lane) => ({ ...lane })),
          lanePositions: wave.lanePositions ? [...wave.lanePositions] : undefined,
        })),
      }));
      const groups = this.groupGeneratedWods(wods);
      return { ...track, wods, groups, columns: groups.flatMap((group) => group.columns) };
    });
  }

  private findWaveLocation(
    tracks: GeneratedTrack[],
    address: WaveAddress,
  ): { trackIndex: number; generatedWodIndex: number; waveIndex: number } | null {
    const trackIndex = tracks.findIndex((track) => track.schedule.id === address.scheduleId);
    if (trackIndex < 0) return null;
    const generatedWodIndex = tracks[trackIndex].wods.findIndex((generatedWod) =>
      generatedWod.wod.id === address.workoutId && generatedWod.category === address.category,
    );
    if (generatedWodIndex < 0) return null;
    const waveIndex = tracks[trackIndex].wods[generatedWodIndex].waves.findIndex((wave) => wave.number === address.waveNumber);
    return waveIndex < 0 ? null : { trackIndex, generatedWodIndex, waveIndex };
  }

  private setLaneTeam(wave: ScheduledWave, laneNumber: number, teamId: string | null): void {
    const laneIndex = wave.lanes.findIndex((lane) => lane.lane === laneNumber);
    if (teamId === null) {
      if (laneIndex >= 0) wave.lanes.splice(laneIndex, 1);
    } else if (laneIndex >= 0) {
      wave.lanes[laneIndex] = { lane: laneNumber, teamId };
    } else {
      wave.lanes.push({ lane: laneNumber, teamId });
    }
    wave.lanes.sort((first, second) => first.lane - second.lane);
    wave.teams = wave.lanes.map((lane) => lane.teamId);
  }

  formatSavedAt(value?: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('fr-CA', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private restoreSavedSchedule(competition: Competition): void {
    const schedules = this.validSavedSchedules(competition);
    const saved = schedules.find((schedule) => schedule.id === competition.activeScheduleId) ?? schedules[0] ?? null;
    if (saved && competition.activeScheduleId !== saved.id) {
      this.competitions.update((competitions) => competitions.map((candidate) =>
        candidate.id === competition.id ? { ...candidate, activeScheduleId: saved.id } : candidate,
      ));
    }
    this.generatedSchedule.set(saved ?? { tracks: [] });
    this.scheduleDirty.set(!saved);
    this.optimizationError.set('');
    this.scheduleEditError.set('');
    this.scheduleExportError.set('');
  }

  private validSavedSchedules(competition: Competition): SavedSchedule[] {
    return (competition.optimizedSchedules ?? [])
      .filter((schedule): schedule is SavedSchedule =>
        Boolean(schedule)
        && typeof schedule.id === 'string'
        && typeof schedule.name === 'string'
        && schedule.algorithmVersion === SCHEDULE_ALGORITHM_VERSION,
      );
  }

  private nextGeneratedScheduleNames(competition: Competition, count: number): string[] {
    const firstNumber = this.validSavedSchedules(competition).length + 1;
    return Array.from({ length: count }, (_, index) => `Horaire ${firstNumber + index}`);
  }

  private mapBackendSchedule(
    competition: Competition,
    response: BackendSchedulePayload | BackendScheduleResponse,
  ): GeneratedScheduleSnapshot {
    const tracks = competition.schedules.map((schedule) => {
      const generatedWods = competition.wods
        .filter((wod) => wod.scheduleId === schedule.id)
        .flatMap((wod) => {
          const assignments = response.assignments.filter((assignment) =>
            assignment.workout.id === wod.id && assignment.timeSlot.scheduleId === schedule.id,
          );
          const byCategoryGroup = new Map<number, typeof assignments>();
          assignments.forEach((assignment) => {
            const group = byCategoryGroup.get(assignment.timeSlot.categoryGroupIndex) ?? [];
            group.push(assignment);
            byCategoryGroup.set(assignment.timeSlot.categoryGroupIndex, group);
          });

          return [...byCategoryGroup.entries()]
            .sort(([first], [second]) => first - second)
            .map(([, groupAssignments]) => {
              const bySlot = new Map<string, typeof groupAssignments>();
              groupAssignments.forEach((assignment) => {
                const slot = bySlot.get(assignment.timeSlot.id) ?? [];
                slot.push(assignment);
                bySlot.set(assignment.timeSlot.id, slot);
              });
              const waves = [...bySlot.values()]
                .sort((first, second) => first[0].timeSlot.waveNumber - second[0].timeSlot.waveNumber)
                .map((slotAssignments) => {
                  const first = slotAssignments[0].timeSlot;
                  const lanes = slotAssignments
                    .map((assignment) => ({ lane: assignment.lane, teamId: assignment.team.id }))
                    .sort((firstLane, secondLane) => firstLane.lane - secondLane.lane);
                  return {
                    number: first.waveNumber,
                    start: this.isoTimeToMinutes(first.start),
                    end: this.isoTimeToMinutes(first.end),
                    teams: lanes.map((lane) => lane.teamId),
                    lanes,
                    capacity: first.laneCount,
                    lanePositions: first.lanePositions,
                  };
                });
              const categories = groupAssignments[0]?.timeSlot.allowedCategories as Category[] ?? [];
              return {
                wod,
                category: categories[0] ?? 'SCALED',
                categories,
                start: Math.min(...waves.map((wave) => wave.start)),
                end: Math.max(...waves.map((wave) => wave.end)),
                waves,
              };
            });
        });
      const groups = this.groupGeneratedWods(generatedWods);
      return { schedule, wods: generatedWods, groups, columns: groups.flatMap((group) => group.columns) };
    });

    return {
      tracks,
      algorithmVersion: SCHEDULE_ALGORITHM_VERSION,
      generatedAt: response.generatedAt,
      score: response.score,
      cached: 'cached' in response ? response.cached : false,
      minimumRestMinutes: response.summary.minimumRestMinutes,
      targetPauseLowerMinutes: response.summary.targetPauseLowerMinutes,
      targetPauseUpperMinutes: response.summary.targetPauseUpperMinutes,
    };
  }

  private isoTimeToMinutes(value: string): number {
    const match = value.match(/T(\d{2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  }

  private optimizationErrorMessage(error: unknown): string {
    const response = error as {
      error?: { message?: string; details?: string[] };
      message?: string;
    };
    const payload = response.error;
    if (payload?.message) {
      const details = payload.details?.filter(Boolean).join(' ');
      return details ? `${payload.message} ${details}` : payload.message;
    }
    return response.message ?? 'Impossible de joindre le backend local. Vérifiez qu’il écoute sur le port 8080.';
  }

  private reportTemporaryError(target: WritableSignal<string>, message: string): void {
    target.set(message);
    this.clearErrorToastTimer();
    this.errorToast.set(message);
    this.errorToastTimer = setTimeout(() => {
      this.errorToast.set('');
      this.errorToastTimer = null;
    }, this.errorToastDurationMs);
  }

  private clearErrorToastTimer(): void {
    if (this.errorToastTimer === null) return;
    clearTimeout(this.errorToastTimer);
    this.errorToastTimer = null;
  }

  categoryLabel(category: Category): string {
    return category === 'SCALED' ? 'Scaled' : category === 'MASTER' ? 'Master' : category === 'INTER' ? 'Inter' : 'RX';
  }

  categoryGroupLabel(category: Category): string {
    return category === 'MASTER' || category === 'SCALED' ? 'Master / Scaled' : this.categoryLabel(category);
  }

  categoryLabels(categories: Category[]): string {
    return categories.map((category) => this.categoryLabel(category)).join(' + ');
  }

  floorLabel(floor: Floor): string {
    return floor === 'main' ? 'Floor 1' : 'Floor 2';
  }

  formatDate(date: string): string {
    const formatted = new Intl.DateTimeFormat('fr-CA', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${date}T12:00:00`));
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  formatTime(totalMinutes: number): string {
    const minutes = Math.max(0, totalMinutes) % (24 * 60);
    const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
    const remainder = (minutes % 60).toString().padStart(2, '0');
    return `${hours}:${remainder}`;
  }

  formatTimeRange(start: number, end: number): string {
    return `${this.formatTime(start)} — ${this.formatTime(end)}`;
  }

  formatIndex(index: number): string {
    return index.toString().padStart(2, '0');
  }

  teamCount(competition: Competition, category: Category): number {
    return competition.teams.filter((team) => team.category === category).length;
  }

  teamCategoryClass(competition: Competition, teamId: string): string {
    const category = competition.teams.find((team) => team.id === teamId)?.category;
    return category ? `category-${category.toLowerCase()}` : '';
  }

  openTeamSchedule(teamId: string): void {
    const competition = this.selectedCompetition();
    const team = competition?.teams.find((candidate) => candidate.id === teamId);
    if (!competition || !team) return;

    const entries = this.entriesForTeam(this.generatedSchedule().tracks, teamId);

    this.teamSchedule.set({ team, entries });
  }

  closeTeamSchedule(): void {
    this.teamSchedule.set(null);
  }

  laneNumbersForWave(column: GeneratedWaveColumn, floor?: Floor): number[] {
    const configuredCapacity = Math.max(
      1,
      Math.min(LANE_ORDER.length, Math.floor(Number(column.generatedWod.wod.teamsPerWave) || 1)),
    );
    const configuredFloor = floor
      ?? this.selectedCompetition()?.schedules.find(
        (schedule) => schedule.id === column.generatedWod.wod.scheduleId,
      )?.floor;
    const lanePositions = configuredFloor === 'main'
      ? LANE_ORDER.slice(0, configuredCapacity)
      : Array.from({ length: configuredCapacity }, (_, index) => index + 1);
    return lanePositions.sort((first, second) => first - second);
  }

  private laneForWod(_wod: Wod, index: number, floor: Floor = 'main'): number {
    if (floor === 'main') return LANE_ORDER[index] ?? index + 1;
    return index + 1;
  }

  formatPause(minutes: number): string {
    const safeMinutes = Math.max(0, Math.round(minutes));
    return `${Math.floor(safeMinutes / 60).toString().padStart(2, '0')}:${(safeMinutes % 60).toString().padStart(2, '0')}`;
  }

  scheduleRows(columns: GeneratedWaveColumn[]): GeneratedWaveColumn[][] {
    const chronologicalColumns = [...columns].sort((first, second) =>
      first.wave.start - second.wave.start
      || first.wave.end - second.wave.end
      || first.generatedWod.wod.id.localeCompare(second.generatedWod.wod.id)
      || first.wave.number - second.wave.number);
    const rows: GeneratedWaveColumn[][] = [];
    for (let index = 0; index < chronologicalColumns.length; index += this.scheduleColumnsPerRow) {
      rows.push(chronologicalColumns.slice(index, index + this.scheduleColumnsPerRow));
    }
    return rows;
  }

  categoryGroupsForColumns(group: GeneratedWodGroup, columns: GeneratedWaveColumn[]): GeneratedCategoryGroup[] {
    const categoryByColumnKey = new Map<string, GeneratedCategoryGroup>();
    group.categories.forEach((categoryGroup) =>
      categoryGroup.columns.forEach((column) =>
        categoryByColumnKey.set(this.generatedWaveColumnKey(column), categoryGroup)));

    const contiguousGroups: Array<{
      source: GeneratedCategoryGroup;
      value: GeneratedCategoryGroup;
    }> = [];
    columns.forEach((column) => {
      const source = categoryByColumnKey.get(this.generatedWaveColumnKey(column)) ?? {
        category: column.generatedWod.category,
        categories: column.generatedWod.categories,
        columns: [column],
      };
      const previous = contiguousGroups.at(-1);
      if (previous?.source === source) {
        previous.value.columns.push(column);
        return;
      }
      contiguousGroups.push({
        source,
        value: { ...source, columns: [column] },
      });
    });

    return contiguousGroups.map((entry) => entry.value);
  }

  private generatedWaveColumnKey(column: GeneratedWaveColumn): string {
    return [
      column.generatedWod.wod.id,
      ...column.generatedWod.categories,
      column.wave.number,
      column.wave.start,
      column.wave.end,
    ].join('|');
  }

  private entriesForTeam(
    tracks: GeneratedTrack[],
    teamId: string,
    columnIds?: Map<GeneratedWod, string>,
  ): TeamScheduleEntry[] {
    const entries = tracks.flatMap((track) => track.wods.flatMap((generatedWod) =>
      generatedWod.waves
        .filter((wave) => wave.lanes.some((lane) => lane.teamId === teamId))
        .map((wave) => ({
          columnId: columnIds?.get(generatedWod) ?? generatedWod.wod.id,
          wod: generatedWod.wod,
          schedule: track.schedule,
          start: wave.start,
          end: wave.end,
        })),
    ));

    return entries
      .sort((first, second) => first.start - second.start)
      .map((entry, index, orderedEntries) => ({
        ...entry,
        restAfter: index === orderedEntries.length - 1
          ? null
          : Math.max(0, orderedEntries[index + 1].start - entry.end),
      }));
  }

  private buildTeamScheduleTable(competition: Competition, tracks: GeneratedTrack[]): TeamScheduleTable {
    const { columns } = this.buildTeamScheduleColumns(tracks);
    const mainColumns = columns.filter((column) => column.schedule.floor === 'main');
    const secondaryColumns = columns.filter((column) => column.schedule.floor === 'secondary');
    const groups = CATEGORY_ORDER
      .map((category) => {
        const rows = competition.teams
          .filter((team) => team.category === category)
          .map((team) => {
            const entries = this.entriesForTeam(tracks, team.id);
            const mainEntries = entries.filter((entry) => entry.schedule.floor === 'main');
            const entriesByColumn = new Map<string, TeamScheduleEntry>();
            const usedSecondaryColumns = new Set<string>();

            entries.forEach((entry) => {
              if (entry.schedule.floor === 'main') {
                const column = mainColumns.find((candidate) => candidate.wodId === entry.wod.id);
                if (column) entriesByColumn.set(column.id, { ...entry, columnId: column.id });
                return;
              }

              const secondarySlot = mainEntries.filter((mainEntry) => mainEntry.start < entry.start).length;
              const exactColumn = secondaryColumns.find((candidate) =>
                candidate.wodId === entry.wod.id
                && candidate.secondarySlot === secondarySlot
                && !usedSecondaryColumns.has(candidate.id),
              );
              const column = exactColumn ?? secondaryColumns
                .filter((candidate) => candidate.wodId === entry.wod.id && !usedSecondaryColumns.has(candidate.id))
                .sort((first, second) =>
                  Math.abs((first.secondarySlot ?? 0) - secondarySlot) - Math.abs((second.secondarySlot ?? 0) - secondarySlot),
                )[0];
              if (column) {
                usedSecondaryColumns.add(column.id);
                entriesByColumn.set(column.id, { ...entry, columnId: column.id });
              }
            });

            return {
              team,
              entries: columns.map((column) => entriesByColumn.get(column.id) ?? null),
            };
          });
        return { category, rows };
      })
      .filter((group) => group.rows.length > 0);

    return { columns, groups };
  }

  private buildTeamScheduleColumns(tracks: GeneratedTrack[]): {
    columns: TeamScheduleColumn[];
    columnIds: Map<GeneratedWod, string>;
  } {
    const generatedWods = tracks
      .flatMap((track, trackIndex) => track.wods
        .filter((generatedWod) => generatedWod.waves.some((wave) => wave.lanes.length > 0))
        .map((generatedWod) => ({
          track,
          trackIndex,
          generatedWod,
          start: Math.min(...generatedWod.waves.filter((wave) => wave.lanes.length > 0).map((wave) => wave.start)),
        })))
      .sort((first, second) =>
        first.start - second.start
        || (first.track.schedule.floor === 'secondary' ? -1 : 1) - (second.track.schedule.floor === 'secondary' ? -1 : 1)
        || first.generatedWod.end - second.generatedWod.end
        || first.trackIndex - second.trackIndex,
      );
    const columnIds = new Map<GeneratedWod, string>();
    const mainColumns: TeamScheduleColumn[] = [];
    const mainColumnByWod = new Map<string, TeamScheduleColumn>();

    generatedWods
      .filter(({ track }) => track.schedule.floor === 'main')
      .sort((first, second) => first.trackIndex - second.trackIndex || first.generatedWod.start - second.generatedWod.start)
      .forEach(({ track, generatedWod, start }) => {
        let column = mainColumnByWod.get(generatedWod.wod.id);
        if (!column) {
          column = {
            id: `${generatedWod.wod.id}-main`,
            wodId: generatedWod.wod.id,
            name: generatedWod.wod.name,
            schedule: track.schedule,
            start,
          };
          mainColumnByWod.set(generatedWod.wod.id, column);
          mainColumns.push(column);
        }

        columnIds.set(generatedWod, column.id);
      });

    const assignedTeamIds = new Set(
      tracks.flatMap((track) => track.wods.flatMap((generatedWod) =>
        generatedWod.waves.flatMap((wave) => wave.lanes.map((lane) => lane.teamId)),
      )),
    );
    const secondaryColumnByKey = new Map<string, TeamScheduleColumn>();
    assignedTeamIds.forEach((teamId) => {
      const entries = this.entriesForTeam(tracks, teamId);
      const mainEntries = entries.filter((entry) => entry.schedule.floor === 'main');
      entries
        .filter((entry) => entry.schedule.floor === 'secondary')
        .forEach((entry) => {
          const secondarySlot = mainEntries.filter((mainEntry) => mainEntry.start < entry.start).length;
          const key = `${entry.wod.id}|${secondarySlot}`;
          const existing = secondaryColumnByKey.get(key);
          if (existing) {
            existing.start = Math.min(existing.start, entry.start);
            return;
          }
          secondaryColumnByKey.set(key, {
            id: `${entry.wod.id}-secondary-slot-${secondarySlot}`,
            wodId: entry.wod.id,
            name: entry.wod.name,
            schedule: entry.schedule,
            start: entry.start,
            secondarySlot,
          });
        });
    });

    const secondaryColumnsBySlot = new Map<number, TeamScheduleColumn[]>();
    secondaryColumnByKey.forEach((column) => {
      const slot = column.secondarySlot ?? mainColumns.length;
      const slotColumns = secondaryColumnsBySlot.get(slot) ?? [];
      slotColumns.push(column);
      secondaryColumnsBySlot.set(slot, slotColumns);
    });
    secondaryColumnsBySlot.forEach((slotColumns) => {
      slotColumns.sort((first, second) =>
        first.start - second.start
        || first.name.localeCompare(second.name, 'fr')
        || first.id.localeCompare(second.id),
      );
    });

    const columns: TeamScheduleColumn[] = [];
    for (let index = 0; index <= mainColumns.length; index += 1) {
      columns.push(...(secondaryColumnsBySlot.get(index) ?? []));
      if (index < mainColumns.length) columns.push(mainColumns[index]);
    }

    return { columns, columnIds };
  }

  private updateCompetition(update: (competition: Competition) => Competition): void {
    const selectedId = this.selectedCompetitionId();
    this.competitions.update((competitions) =>
      competitions.map((competition) => {
        if (competition.id !== selectedId) return competition;
        return {
          ...update(competition),
          optimizedSchedules: [],
          activeScheduleId: null,
          optimizedSchedule: null,
        };
      }),
    );
    this.generatedSchedule.set({ tracks: [] });
    this.scheduleDirty.set(true);
    this.teamSchedule.set(null);
    this.optimizationError.set('');
    this.scheduleEditError.set('');
    this.scheduleExportError.set('');
  }

  private setCategoryPairDraft(competition: Competition | undefined): void {
    const pair = competition?.pairedCategories;
    this.categoryPairDraft = pair ? [pair[0], pair[1]] : ['SCALED', 'MASTER'];
    this.categoryPairError.set('');
  }

  private loadCompetitions(): Competition[] {
    if (typeof window === 'undefined') return [sampleCompetition];

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Competition[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fall back to the starter competition when local storage is unavailable.
    }
    return [sampleCompetition];
  }

  private makeId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private parseTime(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private scoreSchedule(competition: Competition, result: { tracks: GeneratedTrack[] }): ScheduleOptimizationScore {
    const expectedAssignments = competition.teams.length * competition.wods.length;
    const assigned = new Set<string>();
    result.tracks.forEach((track) => track.wods.forEach((generatedWod) => {
      generatedWod.waves.forEach((wave) => wave.teams.forEach((teamId) => assigned.add(`${teamId}:${generatedWod.wod.id}`)));
    }));

    const mainEnd = Math.max(0, ...result.tracks
      .filter((track) => track.schedule.floor === 'main')
      .flatMap((track) => track.wods.map((generatedWod) => generatedWod.end)));
    const secondaryEnd = Math.max(0, ...result.tracks
      .filter((track) => track.schedule.floor === 'secondary')
      .flatMap((track) => track.wods.map((generatedWod) => generatedWod.end)));
    const finishDifference = mainEnd > 0 && secondaryEnd > 0 ? Math.abs(mainEnd - secondaryEnd) : 0;
    let overTwoHours = 0;
    let pauseExcess = 0;
    const categoryPauses = new Map<string, number[]>();

    competition.teams.forEach((team) => {
      const entries = this.entriesForTeam(result.tracks, team.id).sort((first, second) => first.start - second.start);
      entries.forEach((entry, index) => {
        if (index === entries.length - 1) return;
        const pause = Math.max(0, entries[index + 1].start - entry.end);
        if (pause > MAX_IDEAL_PAUSE) {
          overTwoHours += 1;
          pauseExcess += pause - MAX_IDEAL_PAUSE;
        }
        const key = `${team.category}:${index}`;
        const values = categoryPauses.get(key) ?? [];
        values.push(pause);
        categoryPauses.set(key, values);
      });
    });

    const pauseBalance = [...categoryPauses.values()].reduce((total, pauses) =>
      pauses.length < 2 ? total : total + Math.max(...pauses) - Math.min(...pauses), 0);

    return {
      missingAssignments: Math.max(0, expectedAssignments - assigned.size),
      finishOverWindow: Math.max(0, finishDifference - 30),
      finishDifference,
      overTwoHours,
      pauseExcess,
      pauseBalance,
    };
  }

  private isBetterScheduleScore(candidate: ScheduleOptimizationScore, current: ScheduleOptimizationScore): boolean {
    return candidate.missingAssignments < current.missingAssignments
      || (candidate.missingAssignments === current.missingAssignments && candidate.finishOverWindow < current.finishOverWindow)
      || (candidate.missingAssignments === current.missingAssignments && candidate.finishOverWindow === current.finishOverWindow && candidate.finishDifference < current.finishDifference)
      || (candidate.missingAssignments === current.missingAssignments && candidate.finishOverWindow === current.finishOverWindow && candidate.finishDifference === current.finishDifference && candidate.overTwoHours < current.overTwoHours)
      || (candidate.missingAssignments === current.missingAssignments && candidate.finishOverWindow === current.finishOverWindow && candidate.finishDifference === current.finishDifference && candidate.overTwoHours === current.overTwoHours && candidate.pauseExcess < current.pauseExcess)
      || (candidate.missingAssignments === current.missingAssignments && candidate.finishOverWindow === current.finishOverWindow && candidate.finishDifference === current.finishDifference && candidate.overTwoHours === current.overTwoHours && candidate.pauseExcess === current.pauseExcess && candidate.pauseBalance < current.pauseBalance);
  }

  private buildSchedule(competition: Competition | undefined, scenario = 0): { tracks: GeneratedTrack[] } {
    if (!competition) return { tracks: [] };

    const mainTracks = competition.schedules
      .filter((schedule) => schedule.floor === 'main')
      .map((schedule) => this.buildMainTrack(competition, schedule));

    const assignments = new Map<string, AssignedInterval[]>();
    const completedWods = new Map<string, Set<string>>();
    this.assignMainTeams(mainTracks, competition, assignments, completedWods);

    const secondarySchedules = competition.schedules.filter((schedule) => schedule.floor === 'secondary');
    const mainEnd = Math.max(
      0,
      ...mainTracks.flatMap((track) => track.wods.map((generatedWod) => generatedWod.end)),
    );
    const earliestSecondaryEnd = Math.max(
      0,
      ...secondarySchedules.map((schedule) =>
        this.parseTime(schedule.startTime) + this.estimateSecondaryDuration(competition, schedule),
      ),
    );
    // Aim for the primary floor's finish time so all floors end within the
    // same 30-minute window whenever the configured start times allow it.
    const targetSecondaryEnd = Math.max(mainEnd, earliestSecondaryEnd);
    const secondaryTracks = secondarySchedules.map((schedule) => {
      const estimatedDuration = this.estimateSecondaryDuration(competition, schedule);
      const secondaryStart = this.parseTime(schedule.startTime);
      const availableSlack = Math.max(0, targetSecondaryEnd - (secondaryStart + estimatedDuration));
      const transitionCount = this.secondaryTransitionCount(competition, schedule);
      const extraPausePerTransition = transitionCount > 0 ? Math.floor(availableSlack / transitionCount) : 0;
      return this.buildSecondaryTrack(competition, schedule, secondaryStart, targetSecondaryEnd + 30, scenario, extraPausePerTransition, assignments, completedWods);
    });

    return { tracks: [...mainTracks, ...secondaryTracks] };
  }

  private buildMainTrack(competition: Competition, schedule: ScheduleTrack): GeneratedTrack {
    const wods = this.wodsForSchedule(competition, schedule);
    let cursor = this.parseTime(schedule.startTime);
    const generatedWods: GeneratedWod[] = [];

    wods.forEach((wod) => {
      const duration = Math.max(1, Number(wod.duration) || 1);
      const teamsPerWave = Math.max(1, Number(wod.teamsPerWave) || 1);
      const waveInterval = Math.max(0, Number(wod.waveInterval) || 0);
      const categoryInterval = Math.max(0, Number(wod.categoryInterval) || 0);

      this.categoryBatches(competition).forEach((batch, batchIndex) => {
        const batchStart = cursor;
        const categories = [...batch];
        const teamCount = competition.teams.filter((team) => categories.includes(team.category)).length;
        const waveCount = Math.max(1, Math.ceil(teamCount / teamsPerWave));
        const baseWaveCapacity = teamCount > 0 ? Math.floor(teamCount / waveCount) : 0;
        const extraTeams = teamCount > 0 ? teamCount % waveCount : 0;
        const waves: ScheduledWave[] = Array.from({ length: waveCount }, (_, index) => {
          const start = batchStart + index * (duration + waveInterval);
          const capacity = baseWaveCapacity + (index < extraTeams ? 1 : 0);
          return {
            number: index + 1,
            start,
            end: start + duration,
            teams: [],
            lanes: [],
            capacity,
            lanePositions: LANE_ORDER.slice(0, capacity),
          };
        });
        const end = waves[waves.length - 1].end;
        generatedWods.push({ wod, category: categories[0], categories, start: batchStart, end, waves });
        cursor = end + (batchIndex < this.categoryBatches(competition).length - 1 ? categoryInterval : 0);
      });

      cursor += Math.max(0, Number(wod.setupAfter) || 0);
    });

    const groups = this.groupGeneratedWods(generatedWods);
    return { schedule, wods: generatedWods, groups, columns: groups.flatMap((group) => group.columns) };
  }

  private buildSecondaryTrack(
    competition: Competition,
    schedule: ScheduleTrack,
    initialStart: number,
    latestFinish: number,
    scenario: number,
    extraPausePerTransition: number,
    assignments: Map<string, AssignedInterval[]>,
    completedWods: Map<string, Set<string>>,
  ): GeneratedTrack {
    const wods = this.wodsForSchedule(competition, schedule, scenario);
    let cursor = initialStart;
    const generatedWods: GeneratedWod[] = [];

    wods.forEach((wod) => {
      const duration = Math.max(1, Number(wod.duration) || 1);
      const teamsPerWave = Math.max(1, Number(wod.teamsPerWave) || 1);
      const waveInterval = Math.max(0, Number(wod.waveInterval) || 0);
      const categoryInterval = Math.max(0, Number(wod.categoryInterval) || 0);
      const batches = this.orderSecondaryBatches(
        competition,
        wod,
        duration,
        teamsPerWave,
        cursor,
        latestFinish,
        scenario,
        assignments,
        completedWods,
      );
      const teamsInWod = new Set<string>();

      batches.forEach((batch, batchIndex) => {
        const categories = [...batch];
        const teamCount = competition.teams.filter((team) => categories.includes(team.category)).length;
        const waveCount = Math.max(1, Math.ceil(teamCount / teamsPerWave));
        const baseWaveCapacity = teamCount > 0 ? Math.floor(teamCount / waveCount) : 0;
        const extraTeams = teamCount > 0 ? teamCount % waveCount : 0;
        const waves: ScheduledWave[] = [];
        let nextWaveStart = cursor;

        for (let index = 0; index < waveCount; index += 1) {
          const capacity = baseWaveCapacity + (index < extraTeams ? 1 : 0);
          const placed = this.placeSecondaryWave(
            nextWaveStart,
            duration,
            capacity,
            categories,
            wod.id,
            teamsInWod,
            competition,
            latestFinish,
            scenario,
            assignments,
            completedWods,
          );
          const wave: ScheduledWave = {
            number: index + 1,
            start: placed.start,
            end: placed.start + duration,
            teams: placed.teams.map((team) => team.id),
            lanes: placed.teams
              .map((team, teamIndex) => ({ lane: this.laneForWod(wod, teamIndex, 'secondary'), teamId: team.id }))
              .sort((first, second) => first.lane - second.lane),
            capacity,
            lanePositions: Array.from({ length: capacity }, (_, lane) => lane + 1),
          };
          waves.push(wave);
          placed.teams.forEach((team) => {
            teamsInWod.add(team.id);
            this.recordAssignment(team.id, wave, schedule.floor, assignments, completedWods, wod.id);
          });
          nextWaveStart = placed.start + duration + waveInterval + extraPausePerTransition;
        }

        const start = waves[0]?.start ?? cursor;
        const end = waves[waves.length - 1]?.end ?? start + duration;
        generatedWods.push({ wod, category: categories[0], categories, start, end, waves });
        cursor = end + (batchIndex < batches.length - 1 ? categoryInterval + extraPausePerTransition : 0);
      });

      cursor += Math.max(0, Number(wod.setupAfter) || 0);
    });

    const groups = this.groupGeneratedWods(generatedWods);
    return { schedule, wods: generatedWods, groups, columns: groups.flatMap((group) => group.columns) };
  }

  private estimateSecondaryDuration(competition: Competition, schedule: ScheduleTrack): number {
    let duration = 0;

    this.wodsForSchedule(competition, schedule).forEach((wod) => {
      const wodDuration = Math.max(1, Number(wod.duration) || 1);
      const waveInterval = Math.max(0, Number(wod.waveInterval) || 0);
      const categoryInterval = Math.max(0, Number(wod.categoryInterval) || 0);
      const batches = this.categoryBatches(competition);

      batches.forEach((batch, batchIndex) => {
        const teamCount = competition.teams.filter((team) => batch.includes(team.category)).length;
        const waveCount = Math.max(1, Math.ceil(teamCount / Math.max(1, Number(wod.teamsPerWave) || 1)));
        duration += waveCount * wodDuration + Math.max(0, waveCount - 1) * waveInterval;
        if (batchIndex < batches.length - 1) duration += categoryInterval;
      });

      duration += Math.max(0, Number(wod.setupAfter) || 0);
    });

    return duration;
  }

  private secondaryTransitionCount(competition: Competition, schedule: ScheduleTrack): number {
    let transitions = 0;
    const wods = this.wodsForSchedule(competition, schedule);
    const batches = this.categoryBatches(competition);

    wods.forEach((wod, wodIndex) => {
      const teamsPerWave = Math.max(1, Number(wod.teamsPerWave) || 1);
      batches.forEach((batch, batchIndex) => {
        const teamCount = competition.teams.filter((team) => batch.includes(team.category)).length;
        const waveCount = Math.max(1, Math.ceil(teamCount / teamsPerWave));
        transitions += Math.max(0, waveCount - 1);
        if (batchIndex < batches.length - 1) transitions += 1;
      });
      if (wodIndex < wods.length - 1) transitions += 1;
    });

    return transitions;
  }

  private orderSecondaryBatches(
    competition: Competition,
    wod: Wod,
    duration: number,
    teamsPerWave: number,
    cursor: number,
    latestFinish: number,
    scenario: number,
    assignments: Map<string, AssignedInterval[]>,
    completedWods: Map<string, Set<string>>,
  ): Category[][] {
    return this.categoryBatches(competition)
      .map((batch, order) => {
        const teamCount = competition.teams.filter((team) => batch.includes(team.category)).length;
        const waveCount = Math.max(1, Math.ceil(teamCount / teamsPerWave));
        const capacity = teamCount > 0 ? Math.floor(teamCount / waveCount) + (teamCount % waveCount > 0 ? 1 : 0) : 0;
        const preview = this.placeSecondaryWave(
          cursor,
          duration,
          capacity,
          batch,
          wod.id,
          new Set<string>(),
          competition,
          latestFinish,
          scenario,
          assignments,
          completedWods,
        );
        const span = waveCount * duration + Math.max(0, waveCount - 1) * Math.max(0, Number(wod.waveInterval) || 0);
        return { batch, order, start: preview.start, span };
      })
      .sort((first, second) =>
        first.start - second.start
        || second.span - first.span
        || ((first.order + scenario) % this.categoryBatches(competition).length) - ((second.order + scenario) % this.categoryBatches(competition).length),
      )
      .map((entry) => entry.batch);
  }

  private wodsForSchedule(competition: Competition, schedule: ScheduleTrack, scenario = 0): Wod[] {
    const wods = competition.wods
      .filter((wod) => wod.scheduleId === schedule.id)
      .sort((first, second) => competition.wods.indexOf(first) - competition.wods.indexOf(second));

    if (schedule.floor === 'main' || wods.length < 2 || scenario === 0) return wods;

    const offset = (scenario - 1) % wods.length;
    return [...wods.slice(offset), ...wods.slice(0, offset)];
  }

  private categoryBatches(competition: Competition): Category[][] {
    const paired: Category[] = competition.pairedCategories ? [...competition.pairedCategories] : [];
    const usedCategories = new Set<Category>();
    const batches: Category[][] = [];

    CATEGORY_ORDER.forEach((category) => {
      if (usedCategories.has(category)) return;
      const batch = paired.includes(category)
        ? CATEGORY_ORDER.filter((candidate) => paired.includes(candidate))
        : [category];
      batch.forEach((item) => usedCategories.add(item));
      batches.push(batch);
    });

    return batches;
  }

  private assignMainTeams(
    tracks: GeneratedTrack[],
    competition: Competition,
    assignments: Map<string, AssignedInterval[]>,
    completedWods: Map<string, Set<string>>,
  ): void {
    const waveReferences = tracks
      .flatMap((track) => track.wods.flatMap((generatedWod) => generatedWod.waves.map((wave) => ({ track, generatedWod, wave }))))
      .sort((first, second) => first.wave.start - second.wave.start || first.wave.end - second.wave.end);

    for (const reference of waveReferences) {
      const categories = reference.generatedWod.categories;
      const wodId = reference.generatedWod.wod.id;
      const alreadyInWod = new Set(
        reference.generatedWod.waves.flatMap((wave) => wave.teams),
      );
      const availableTeams = competition.teams
        .filter((team) => categories.includes(team.category) && !alreadyInWod.has(team.id) && !completedWods.get(team.id)?.has(wodId));

      const selected = availableTeams
        .filter((team) => this.canAssignTeam(team.id, reference.wave, reference.track.schedule.floor, assignments))
        .slice(0, reference.wave.capacity);

      reference.wave.teams = selected.map((team) => team.id);
      reference.wave.lanes = selected
        .map((team, index) => ({
          lane: this.laneForWod(reference.generatedWod.wod, index, reference.track.schedule.floor),
          teamId: team.id,
        }))
        .sort((first, second) => first.lane - second.lane);
      selected.forEach((team) => {
        this.recordAssignment(team.id, reference.wave, reference.track.schedule.floor, assignments, completedWods, wodId);
      });
    }
  }

  private placeSecondaryWave(
    nominalStart: number,
    duration: number,
    capacity: number,
    categories: Category[],
    wodId: string,
    teamsInWod: Set<string>,
    competition: Competition,
    latestFinish: number,
    scenario: number,
    assignments: Map<string, AssignedInterval[]>,
    completedWods: Map<string, Set<string>>,
  ): { start: number; teams: Team[] } {
    let candidate = nominalStart;
    const maximumSearchMinutes = 3 * 24 * 60;
    const optimizationWindow = 4 * 60;
    let firstFeasible: { start: number; teams: Team[] } | undefined;
    let bestPlacement: { start: number; teams: Team[] } | undefined;
    let bestScore: ReturnType<typeof this.secondaryPlacementScore> | undefined;

    for (let minute = 0; minute <= maximumSearchMinutes; minute += 1) {
      const available = competition.teams.filter((team) =>
        categories.includes(team.category)
        && !teamsInWod.has(team.id)
        && !completedWods.get(team.id)?.has(wodId)
        && this.canAssignTeam(team.id, { number: 0, start: candidate, end: candidate + duration, teams: [], lanes: [], capacity }, 'secondary', assignments),
      );
      if (available.length >= capacity) {
        const placement = {
          start: candidate,
          teams: this.selectBalancedTeams(available, capacity, candidate, duration, scenario, assignments),
        };
        firstFeasible ??= placement;
        const score = this.secondaryPlacementScore(placement.teams, candidate, duration, assignments, latestFinish, candidate - nominalStart);
        if (!bestScore || this.isBetterPlacementScore(score, bestScore)) {
          bestPlacement = placement;
          bestScore = score;
        }
        if (minute >= optimizationWindow) return bestPlacement ?? placement;
      }
      candidate += 1;
      if (minute >= optimizationWindow && bestPlacement) return bestPlacement;
    }

    if (bestPlacement) return bestPlacement;
    if (firstFeasible) return firstFeasible;

    const available = competition.teams.filter((team) =>
      categories.includes(team.category) && !teamsInWod.has(team.id) && !completedWods.get(team.id)?.has(wodId),
    );
    return { start: candidate, teams: this.selectBalancedTeams(available, capacity, candidate, duration, scenario, assignments) };
  }

  private selectBalancedTeams(
    available: Team[],
    capacity: number,
    start: number,
    duration: number,
    scenario: number,
    assignments: Map<string, AssignedInterval[]>,
  ): Team[] {
    if (available.length <= capacity) return available.slice(0, capacity);

    const ordered = [...available].sort((first, second) => {
      const firstBefore = this.pauseProfile(first.id, start, duration, assignments).before ?? Number.POSITIVE_INFINITY;
      const secondBefore = this.pauseProfile(second.id, start, duration, assignments).before ?? Number.POSITIVE_INFINITY;
      return firstBefore - secondBefore || first.id.localeCompare(second.id);
    });
    const windowCount = ordered.length - capacity + 1;
    let bestIndex = scenario % windowCount;
    let bestTeams = ordered.slice(bestIndex, bestIndex + capacity);
    let bestScore = this.pauseBalanceScore(bestTeams, start, duration, assignments);

    for (let index = 0; index <= ordered.length - capacity; index += 1) {
      const candidate = ordered.slice(index, index + capacity);
      const score = this.pauseBalanceScore(candidate, start, duration, assignments);
      const currentTieOrder = (bestIndex + scenario) % windowCount;
      const candidateTieOrder = (index + scenario) % windowCount;
      if (score < bestScore || (score === bestScore && candidateTieOrder < currentTieOrder)) {
        bestScore = score;
        bestTeams = candidate;
        bestIndex = index;
      }
    }

    return bestTeams;
  }

  private pauseBalanceScore(
    teams: Team[],
    start: number,
    duration: number,
    assignments: Map<string, AssignedInterval[]>,
  ): number {
    let score = 0;
    const categories = [...new Set(teams.map((team) => team.category))];

    categories.forEach((category) => {
      const categoryTeams = teams.filter((team) => team.category === category);
      const profiles = categoryTeams.map((team) => this.pauseProfile(team.id, start, duration, assignments));
      score += this.pauseSpread(profiles.map((profile) => profile.before));
      score += this.pauseSpread(profiles.map((profile) => profile.after));
    });

    return score;
  }

  private pauseSpread(values: Array<number | null>): number {
    const defined = values.filter((value): value is number => value !== null);
    if (defined.length < 2) return 0;
    return Math.max(...defined) - Math.min(...defined);
  }

  private pauseProfile(
    teamId: string,
    start: number,
    duration: number,
    assignments: Map<string, AssignedInterval[]>,
  ): { before: number | null; after: number | null } {
    const intervals = [...(assignments.get(teamId) ?? [])].sort((first, second) => first.start - second.start);
    const previous = intervals.filter((interval) => interval.end <= start).at(-1);
    const next = intervals.find((interval) => interval.start >= start + duration);

    return {
      before: previous ? start - previous.end : null,
      after: next ? next.start - (start + duration) : null,
    };
  }

  private secondaryPlacementScore(
    teams: Team[],
    start: number,
    duration: number,
    assignments: Map<string, AssignedInterval[]>,
    latestFinish: number,
    delay: number,
  ): {
    overDeadline: number;
    overTwoHours: number;
    excess: number;
    maxPause: number;
    balance: number;
    delay: number;
  } {
    const pauses = teams.flatMap((team) => {
      const profile = this.pauseProfile(team.id, start, duration, assignments);
      return [profile.before, profile.after].filter((pause): pause is number => pause !== null);
    });
    const overTwoHours = pauses.filter((pause) => pause > MAX_IDEAL_PAUSE);
    return {
      overDeadline: Math.max(0, start + duration - latestFinish),
      overTwoHours: overTwoHours.length,
      excess: overTwoHours.reduce((total, pause) => total + pause - MAX_IDEAL_PAUSE, 0),
      maxPause: pauses.length ? Math.max(...pauses) : 0,
      balance: this.pauseBalanceScore(teams, start, duration, assignments),
      delay,
    };
  }

  private isBetterPlacementScore(
    candidate: ReturnType<typeof this.secondaryPlacementScore>,
    current: ReturnType<typeof this.secondaryPlacementScore>,
  ): boolean {
    return candidate.overDeadline < current.overDeadline
      // When both placements still finish before the target, keep the earliest
      // one. The schedule builder spreads the available slack between
      // transitions; delaying a whole category here would push WOD2 to the
      // afternoon for no scheduling benefit.
      || (candidate.overDeadline === current.overDeadline && candidate.delay < current.delay)
      || (candidate.overDeadline === current.overDeadline && candidate.delay === current.delay && candidate.overTwoHours < current.overTwoHours)
      || (candidate.overDeadline === current.overDeadline && candidate.delay === current.delay && candidate.overTwoHours === current.overTwoHours && candidate.excess < current.excess)
      || (candidate.overDeadline === current.overDeadline && candidate.delay === current.delay && candidate.overTwoHours === current.overTwoHours && candidate.excess === current.excess && candidate.maxPause < current.maxPause)
      || (candidate.overDeadline === current.overDeadline && candidate.delay === current.delay && candidate.overTwoHours === current.overTwoHours && candidate.excess === current.excess && candidate.maxPause === current.maxPause && candidate.balance < current.balance);
  }

  private recordAssignment(
    teamId: string,
    wave: ScheduledWave,
    floor: Floor,
    assignments: Map<string, AssignedInterval[]>,
    completedWods: Map<string, Set<string>>,
    wodId: string,
  ): void {
    const current = assignments.get(teamId) ?? [];
    current.push({ start: wave.start, end: wave.end, floor });
    assignments.set(teamId, current);
    const completed = completedWods.get(teamId) ?? new Set<string>();
    completed.add(wodId);
    completedWods.set(teamId, completed);
  }

  private groupGeneratedWods(wods: GeneratedWod[]): GeneratedWodGroup[] {
    const groups: GeneratedWodGroup[] = [];

    for (const generatedWod of wods) {
      let group = groups[groups.length - 1];
      if (!group || group.wod.id !== generatedWod.wod.id) {
        group = { wod: generatedWod.wod, categories: [], columns: [] };
        groups.push(group);
      }

      const columns = generatedWod.waves.map((wave) => ({ generatedWod, wave }));
      group.categories.push({ category: generatedWod.category, categories: generatedWod.categories, columns });
      group.columns.push(...columns);
    }

    return groups;
  }

  private canAssignTeam(
    teamId: string,
    wave: ScheduledWave,
    floor: Floor,
    assignments: Map<string, AssignedInterval[]>,
  ): boolean {
    const intervals = assignments.get(teamId) ?? [];
    return intervals.every((interval) => {
      const buffer = floor === 'secondary' || interval.floor === 'secondary' ? 60 : 0;
      return wave.start >= interval.end + buffer || interval.start >= wave.end + buffer;
    });
  }
}
