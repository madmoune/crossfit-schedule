import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import { App, type Competition, type SavedSchedule } from './app';
import { BackendScheduleService } from './backend-schedule.service';
import { FirebaseService } from './firebase.service';

const backendScheduleMock: Pick<BackendScheduleService, 'optimize'> = {
  optimize: async () => {
    throw new Error('Backend mock not configured for this test.');
  },
};

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        { provide: BackendScheduleService, useValue: backendScheduleMock },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Bon retour.');
  });

  it('shows operational errors in a temporary popup', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    vi.useFakeTimers();

    try {
      (app as any).reportTemporaryError(app.scheduleEditError, 'Déplacement refusé.');
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.error-toast')?.textContent)
        .toContain('Déplacement refusé.');

      vi.advanceTimersByTime(app.errorToastDurationMs);
      fixture.detectChanges();

      expect(app.errorToast()).toBe('');
      expect(fixture.nativeElement.querySelector('.error-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a small animated status while generating schedules', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const competition: Competition = {
      id: 'competition-loading',
      name: 'Test animation',
      date: '2026-08-15',
      schedules: [],
      wods: [],
      teams: [],
      pairedCategories: null,
      optimizedSchedules: [],
      activeScheduleId: null,
    };

    firebase.authReady.set(true);
    firebase.user.set({ uid: 'test-user', displayName: 'Test' } as any);
    firebase.dataReady.set(true);
    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.generatedScheduleCount = 3;
    app.optimizationBusy.set(true);
    fixture.detectChanges();

    const loader = (fixture.nativeElement as HTMLElement).querySelector('.schedule-generation-loader');
    expect(loader?.getAttribute('role')).toBe('status');
    expect(loader?.textContent).toContain('Création de 3 horaires');
    expect(loader?.querySelectorAll('.generation-loader-lanes i')).toHaveLength(5);
    expect(fixture.nativeElement.querySelector('.generation-main-button')?.textContent).toContain('Optimisation');

    app.optimizationBusy.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.schedule-generation-loader')).toBeNull();
  });

  it('keeps, selects and deletes generated schedules independently', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const first = savedSchedule('generated-1', 'Version finale', '0hard/10soft');
    const second = savedSchedule('generated-2', 'Version matin', '0hard/12soft');
    const competition: Competition = {
      id: 'competition-test',
      name: 'Test competition',
      date: '2026-08-15',
      schedules: [],
      wods: [],
      teams: [],
      pairedCategories: null,
      optimizedSchedules: [first, second],
      activeScheduleId: first.id,
    };

    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.selectGeneratedSchedule(second.id);

    expect(app.generatedSchedule().score).toBe(second.score);
    expect(firebase.competitions()[0].activeScheduleId).toBe(second.id);

    app.requestDeleteGeneratedSchedule(second);
    expect(app.deleteTarget()?.kind).toBe('generatedSchedule');
    app.removeGeneratedSchedule(second.id);

    expect(firebase.competitions()[0].optimizedSchedules?.map((schedule) => schedule.id)).toEqual([first.id]);
    expect(app.generatedSchedule().score).toBe(first.score);
  });

  it('asks for a separate name for every requested schedule', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const competition: Competition = {
      id: 'competition-names',
      name: 'Named alternatives',
      date: '2026-08-15',
      schedules: [],
      wods: [],
      teams: [],
      pairedCategories: null,
      optimizedSchedules: [],
      activeScheduleId: null,
    };

    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.openGeneratedScheduleDialog(3);

    expect(app.generatedScheduleFormOpen()).toBe(true);
    expect(app.generatedScheduleNames).toEqual(['Horaire 1', 'Horaire 2', 'Horaire 3']);
    expect(app.generatedScheduleNamesValid()).toBe(true);
  });

  it('saves the three best backend alternatives as separate schedules', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const alternative = (rank: number, score: string) => ({
      rank,
      resolutionStatus: 'FEASIBLE',
      generatedAt: `2026-07-28T18:0${rank}:00Z`,
      score,
      scoreDetails: { hard: 0, soft: -rank },
      solver: { status: 'COMPLETED', timeLimitSeconds: 3, elapsedMilliseconds: 1000 },
      summary: {
        teamCount: 0,
        workoutCount: 0,
        timeSlotCount: 0,
        assignmentCount: 0,
        minimumRestMinutes: 60,
        targetPauseLowerMinutes: 75,
        targetPauseUpperMinutes: 105,
        mainFinish: null,
        secondaryFinish: null,
      },
      assignments: [],
      warnings: [],
    });
    const alternatives = [alternative(1, '0hard/-1soft'), alternative(2, '0hard/-2soft'), alternative(3, '0hard/-3soft')];
    const response = {
      competitionId: 'competition-alternatives',
      ...alternatives[0],
      cached: false,
      alternatives,
    } as any;
    backendScheduleMock.optimize = async (_competition, alternativeCount) => {
      expect(alternativeCount).toBe(3);
      return response;
    };
    const competition: Competition = {
      id: 'competition-alternatives',
      name: 'Top three',
      date: '2026-08-15',
      schedules: [],
      wods: [],
      teams: [],
      pairedCategories: null,
      optimizedSchedules: [],
      activeScheduleId: null,
    };

    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.generatedScheduleNames = ['Finale', 'Matin', 'Alternative'];
    await app.generateSchedule();

    expect(firebase.competitions()[0].optimizedSchedules?.map((schedule) => schedule.name))
      .toEqual(['Finale', 'Matin', 'Alternative']);
    expect(firebase.competitions()[0].activeScheduleId)
      .toBe(firebase.competitions()[0].optimizedSchedules?.[0].id);
  });

  it('does not save a partial generation when three schedules were requested', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const response = {
      competitionId: 'competition-partial',
      resolutionStatus: 'FEASIBLE',
      generatedAt: '2026-07-28T18:00:00Z',
      score: '0hard/0soft',
      scoreDetails: { hard: 0, soft: 0 },
      solver: { status: 'COMPLETED', timeLimitSeconds: 10, elapsedMilliseconds: 1000 },
      summary: {
        teamCount: 0,
        workoutCount: 0,
        timeSlotCount: 0,
        assignmentCount: 0,
        minimumRestMinutes: 60,
        targetPauseLowerMinutes: 75,
        targetPauseUpperMinutes: 105,
        mainFinish: null,
        secondaryFinish: null,
      },
      assignments: [],
      warnings: [],
      cached: false,
      alternatives: [],
    } as any;
    backendScheduleMock.optimize = async () => response;
    const competition: Competition = {
      id: 'competition-partial',
      name: 'Partial generation',
      date: '2026-08-15',
      schedules: [],
      wods: [],
      teams: [],
      pairedCategories: null,
      optimizedSchedules: [],
      activeScheduleId: null,
    };

    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.generatedScheduleCount = 3;
    app.generatedScheduleNames = ['Un', 'Deux', 'Trois'];
    await app.generateSchedule();

    expect(firebase.competitions()[0].optimizedSchedules).toEqual([]);
    expect(app.optimizationError()).toContain("sur les 3 demandés");
  });

  it('allows dropping a team into a free lane and saves the edited schedule', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const schedule = { id: 'schedule-main', name: 'Floor 1', startTime: '09:00', floor: 'main' as const };
    const wod = { id: 'wod-1', name: 'WOD 1', duration: 10, teamsPerWave: 1, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: schedule.id };
    const team = { id: 'team-1', name: 'Team 1', category: 'SCALED' as const };
    const generatedWod = generatedWodWithWaves(wod, [
      { number: 1, start: 540, end: 550, teams: [team.id], lanes: [{ lane: 5, teamId: team.id }], capacity: 1, lanePositions: [5] },
      { number: 2, start: 560, end: 570, teams: [], lanes: [], capacity: 1, lanePositions: [6] },
    ]);
    const track = generatedTrack(schedule, generatedWod);
    const saved = { ...savedSchedule('generated-free', 'Case libre', '0hard/0soft'), tracks: [track] };
    const competition: Competition = {
      id: 'competition-free',
      name: 'Test competition',
      date: '2026-08-15',
      schedules: [schedule],
      wods: [wod],
      teams: [team],
      pairedCategories: null,
      optimizedSchedules: [saved],
      activeScheduleId: saved.id,
    };

    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.generatedSchedule.set(saved);
    const sourceColumn = { generatedWod, wave: generatedWod.waves[0] };
    const targetColumn = { generatedWod, wave: generatedWod.waves[1] };
    const event = dragEvent();

    app.startTeamDrag(event, track, sourceColumn, 5, team.id);
    app.dropTeam(event, track, targetColumn, 6);

    const waves = app.generatedSchedule().tracks[0].wods[0].waves;
    expect(waves[0].lanes).toEqual([]);
    expect(waves[1].lanes).toEqual([{ lane: 6, teamId: team.id }]);
    expect(firebase.competitions()[0].optimizedSchedules?.[0].tracks[0].wods[0].waves[1].lanes)
      .toEqual([{ lane: 6, teamId: team.id }]);
  });

  it('marks only the exact dragged occurrence of a team', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const schedule = { id: 'schedule-main', name: 'Floor 1', startTime: '09:00', floor: 'main' as const };
    const firstWod = { id: 'wod-first', name: 'WOD 1', duration: 10, teamsPerWave: 1, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: schedule.id };
    const secondWod = { id: 'wod-second', name: 'WOD 2', duration: 10, teamsPerWave: 1, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: schedule.id };
    const team = { id: 'team-shared', name: 'Même équipe', category: 'SCALED' as const };
    const firstGeneratedWod = generatedWodWithWaves(firstWod, [
      { number: 1, start: 540, end: 550, teams: [team.id], lanes: [{ lane: 5, teamId: team.id }], capacity: 1, lanePositions: [5] },
    ]);
    const secondGeneratedWod = generatedWodWithWaves(secondWod, [
      { number: 1, start: 620, end: 630, teams: [team.id], lanes: [{ lane: 5, teamId: team.id }], capacity: 1, lanePositions: [5] },
    ]);
    const track = {
      schedule,
      wods: [firstGeneratedWod, secondGeneratedWod],
      groups: [],
      columns: [],
    } as any;
    const saved = { ...savedSchedule('generated-source', 'Source exacte', '0hard/0soft'), tracks: [track] };
    const competition: Competition = {
      id: 'competition-source',
      name: 'Test source',
      date: '2026-08-15',
      schedules: [schedule],
      wods: [firstWod, secondWod],
      teams: [team],
      pairedCategories: null,
      optimizedSchedules: [saved],
      activeScheduleId: saved.id,
    };

    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.generatedSchedule.set(saved);
    const firstColumn = { generatedWod: firstGeneratedWod, wave: firstGeneratedWod.waves[0] };
    const secondColumn = { generatedWod: secondGeneratedWod, wave: secondGeneratedWod.waves[0] };

    app.startTeamDrag(dragEvent(), track, firstColumn, 5, team.id);

    expect(app.isDraggedSource(track, firstColumn, 5)).toBe(true);
    expect(app.isDraggedSource(track, firstColumn, 6)).toBe(false);
    expect(app.isDraggedSource(track, secondColumn, 5)).toBe(false);
  });

  it('updates the team schedule after a floor drag and drop', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const schedule = { id: 'schedule-main', name: 'Floor 1', startTime: '09:00', floor: 'main' as const };
    const wod = { id: 'wod-team-view', name: 'WOD équipe', duration: 10, teamsPerWave: 1, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: schedule.id };
    const team = { id: 'team-view', name: 'Équipe vue', category: 'SCALED' as const };
    const generatedWod = generatedWodWithWaves(wod, [
      { number: 1, start: 540, end: 550, teams: [team.id], lanes: [{ lane: 5, teamId: team.id }], capacity: 1, lanePositions: [5] },
      { number: 2, start: 600, end: 610, teams: [], lanes: [], capacity: 1, lanePositions: [6] },
    ]);
    const track = generatedTrack(schedule, generatedWod);
    const saved = { ...savedSchedule('generated-team-view', 'Vue équipe', '0hard/0soft'), tracks: [track] };
    const competition: Competition = {
      id: 'competition-team-view',
      name: 'Test vue équipe',
      date: '2026-08-15',
      schedules: [schedule],
      wods: [wod],
      teams: [team],
      pairedCategories: null,
      optimizedSchedules: [saved],
      activeScheduleId: saved.id,
    };

    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.generatedSchedule.set(saved);
    expect(app.teamScheduleTable().groups[0].rows[0].entries[0]?.start).toBe(540);

    const sourceColumn = { generatedWod, wave: generatedWod.waves[0] };
    const targetColumn = { generatedWod, wave: generatedWod.waves[1] };
    app.startTeamDrag(dragEvent(), track, sourceColumn, 5, team.id);
    app.dropTeam(dragEvent(), track, targetColumn, 6);

    expect(app.teamScheduleTable().groups[0].rows[0].entries[0]?.start).toBe(600);
    expect(app.teamScheduleTable().groups[0].rows[0].entries[0]?.end).toBe(610);
  });

  it('moves a secondary team entry to the correct chronological column after a drop', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const mainSchedule = { id: 'schedule-main', name: 'Floor 1', startTime: '09:00', floor: 'main' as const };
    const secondarySchedule = { id: 'schedule-secondary', name: 'Floor 2', startTime: '07:00', floor: 'secondary' as const };
    const firstMainWod = { id: 'wod-main-first', name: 'Main 1', duration: 10, teamsPerWave: 2, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: mainSchedule.id };
    const secondMainWod = { id: 'wod-main-second', name: 'Main 2', duration: 10, teamsPerWave: 2, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: mainSchedule.id };
    const secondaryWod = { id: 'wod-secondary-view', name: 'Secondaire', duration: 10, teamsPerWave: 2, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: secondarySchedule.id };
    const firstTeam = { id: 'team-first', name: 'Équipe A', category: 'SCALED' as const };
    const secondTeam = { id: 'team-second', name: 'Équipe B', category: 'SCALED' as const };
    const mainLanes = [{ lane: 5, teamId: firstTeam.id }, { lane: 6, teamId: secondTeam.id }];
    const firstMainGeneratedWod = generatedWodWithWaves(firstMainWod, [
      { number: 1, start: 540, end: 550, teams: [firstTeam.id, secondTeam.id], lanes: mainLanes, capacity: 2, lanePositions: [5, 6] },
    ]);
    const secondMainGeneratedWod = generatedWodWithWaves(secondMainWod, [
      { number: 1, start: 720, end: 730, teams: [firstTeam.id, secondTeam.id], lanes: mainLanes, capacity: 2, lanePositions: [5, 6] },
    ]);
    const secondaryGeneratedWod = generatedWodWithWaves(secondaryWod, [
      {
        number: 1,
        start: 610,
        end: 620,
        teams: [firstTeam.id, secondTeam.id],
        lanes: [{ lane: 1, teamId: firstTeam.id }, { lane: 2, teamId: secondTeam.id }],
        capacity: 2,
        lanePositions: [1, 2],
      },
      { number: 2, start: 460, end: 470, teams: [], lanes: [], capacity: 2, lanePositions: [1, 2] },
    ]);
    const mainTrack = {
      schedule: mainSchedule,
      wods: [firstMainGeneratedWod, secondMainGeneratedWod],
      groups: [],
      columns: [],
    } as any;
    const secondaryTrack = generatedTrack(secondarySchedule, secondaryGeneratedWod);
    const saved = {
      ...savedSchedule('generated-secondary-columns', 'Colonnes secondaires', '0hard/0soft'),
      minimumRestMinutes: 60,
      tracks: [mainTrack, secondaryTrack],
    };
    const competition: Competition = {
      id: 'competition-secondary-columns',
      name: 'Test colonnes secondaires',
      date: '2026-08-15',
      schedules: [mainSchedule, secondarySchedule],
      wods: [firstMainWod, secondMainWod, secondaryWod],
      teams: [firstTeam, secondTeam],
      pairedCategories: null,
      optimizedSchedules: [saved],
      activeScheduleId: saved.id,
    };

    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.generatedSchedule.set(saved);
    expect(app.teamScheduleTable().columns.map((column) => column.id)).toEqual([
      'wod-main-first-main',
      'wod-secondary-view-secondary-slot-1',
      'wod-main-second-main',
    ]);

    const sourceColumn = { generatedWod: secondaryGeneratedWod, wave: secondaryGeneratedWod.waves[0] };
    const targetColumn = { generatedWod: secondaryGeneratedWod, wave: secondaryGeneratedWod.waves[1] };
    app.startTeamDrag(dragEvent(), secondaryTrack, sourceColumn, 1, firstTeam.id);
    app.dropTeam(dragEvent(), secondaryTrack, targetColumn, 1);

    expect(app.scheduleEditError()).toBe('');
    expect(app.teamScheduleTable().columns.map((column) => column.id)).toEqual([
      'wod-secondary-view-secondary-slot-0',
      'wod-main-first-main',
      'wod-secondary-view-secondary-slot-1',
      'wod-main-second-main',
    ]);
    const rows = app.teamScheduleTable().groups[0].rows;
    expect(rows.find((row) => row.team.id === firstTeam.id)?.entries.map((entry) => entry?.start ?? null))
      .toEqual([460, 540, null, 720]);
    expect(rows.find((row) => row.team.id === secondTeam.id)?.entries.map((entry) => entry?.start ?? null))
      .toEqual([null, 540, 610, 720]);
  });

  it('displays configured lanes in numeric order independently of the balanced wave size', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const wod = {
      id: 'wod-lanes',
      name: 'Lane order',
      duration: 10,
      teamsPerWave: 10,
      waveInterval: 5,
      categoryInterval: 5,
      setupAfter: 5,
      scheduleId: 'schedule-main',
    };
    const column = {
      generatedWod: generatedWodWithWaves(wod, []),
      wave: {
        number: 1,
        start: 540,
        end: 550,
        teams: [],
        lanes: [],
        capacity: 10,
        lanePositions: [5, 6, 4, 7, 3, 8, 2, 9, 1, 10],
      },
    } as any;

    expect(app.laneNumbersForWave(column, 'main')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(app.laneNumbersForWave({ ...column, wave: { ...column.wave, capacity: 9, lanePositions: [5, 6, 4, 7, 3, 8, 2, 9, 1] } }, 'main'))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const fiveLaneColumn = {
      ...column,
      generatedWod: generatedWodWithWaves({ ...wod, teamsPerWave: 5 }, []),
      wave: { ...column.wave, capacity: 4, lanePositions: [1, 2, 3, 4] },
    };
    expect(app.laneNumbersForWave(fiveLaneColumn, 'secondary')).toEqual([1, 2, 3, 4, 5]);
    expect(app.laneNumbersForWave(fiveLaneColumn, 'main')).toEqual([3, 4, 5, 6, 7]);
  });

  it('renders only five lane rows for a secondary WOD configured for five teams per wave', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const schedule = { id: 'schedule-secondary', name: 'Floor 2', startTime: '09:00', floor: 'secondary' as const };
    const wod = { id: 'wod-five-lanes', name: 'WOD 2', duration: 15, teamsPerWave: 5, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: schedule.id };
    const teams = Array.from({ length: 4 }, (_, index) => ({
      id: `team-${index + 1}`,
      name: `Team ${index + 1}`,
      category: 'SCALED' as const,
    }));
    const generatedWod = generatedWodWithWaves(wod, [{
      number: 1,
      start: 540,
      end: 555,
      teams: teams.map((team) => team.id),
      lanes: teams.map((team, index) => ({ lane: index + 1, teamId: team.id })),
      capacity: 4,
      lanePositions: [1, 2, 3, 4],
    }]);
    const columns = [{ generatedWod, wave: generatedWod.waves[0] }];
    const track = {
      schedule,
      wods: [generatedWod],
      groups: [{ wod, categories: [{ category: 'SCALED', categories: ['SCALED'], columns }], columns }],
      columns,
    } as any;
    const saved = { ...savedSchedule('generated-five-lanes', 'Cinq lanes', '0hard/0soft'), tracks: [track] };
    const competition: Competition = {
      id: 'competition-five-lanes',
      name: 'Test cinq lanes',
      date: '2026-08-15',
      schedules: [schedule],
      wods: [wod],
      teams,
      pairedCategories: null,
      optimizedSchedules: [saved],
      activeScheduleId: saved.id,
    };

    firebase.authReady.set(true);
    firebase.user.set({ uid: 'test-user', displayName: 'Test' } as any);
    firebase.dataReady.set(true);
    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.generatedSchedule.set(saved);
    fixture.detectChanges();

    const laneRows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.wave-list .schedule-team')];
    expect(laneRows).toHaveLength(5);
    expect(laneRows.map((row) => row.querySelector('span')?.textContent?.trim())).toEqual(['1', '2', '3', '4', '5']);
    expect(laneRows[4].classList).toContain('schedule-team-empty');
  });

  it('displays waves chronologically across category groups', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const wod = {
      id: 'wod-chronological',
      name: 'WOD chronologique',
      duration: 15,
      teamsPerWave: 5,
      waveInterval: 5,
      categoryInterval: 5,
      setupAfter: 5,
      scheduleId: 'schedule-secondary',
    };
    const wave = (number: number, start: number) => ({
      number,
      start,
      end: start + 15,
      teams: [],
      lanes: [],
      capacity: 5,
      lanePositions: [1, 2, 3, 4, 5],
    });
    const rxWod = {
      ...generatedWodWithWaves(wod, [wave(1, 748), wave(2, 768)]),
      category: 'RX',
      categories: ['RX'],
    };
    const pairedWod = {
      ...generatedWodWithWaves(wod, [wave(1, 793), wave(2, 813), wave(3, 833), wave(4, 853)]),
      category: 'SCALED',
      categories: ['MASTER', 'SCALED'],
    };
    const interWod = {
      ...generatedWodWithWaves(wod, Array.from({ length: 8 }, (_, index) => wave(index + 1, 893 + index * 20))),
      category: 'INTER',
      categories: ['INTER'],
    };
    const columnsFor = (generatedWod: any) =>
      generatedWod.waves.map((scheduledWave: any) => ({ generatedWod, wave: scheduledWave }));
    const pairedColumns = columnsFor(pairedWod);
    const interColumns = columnsFor(interWod);
    const rxColumns = columnsFor(rxWod);
    const group = {
      wod,
      categories: [
        { category: 'SCALED', categories: ['MASTER', 'SCALED'], columns: pairedColumns },
        { category: 'INTER', categories: ['INTER'], columns: interColumns },
        { category: 'RX', categories: ['RX'], columns: rxColumns },
      ],
      // Reproduces the previous category-grouped order from the screenshot.
      columns: [...pairedColumns, ...interColumns, ...rxColumns],
    } as any;

    const rows = app.scheduleRows(group.columns);

    expect(rows.flat().map((column) => column.wave.start)).toEqual([
      748, 768,
      793, 813, 833, 853,
      893, 913, 933, 953, 973, 993, 1013, 1033,
    ]);
    expect(app.categoryGroupsForColumns(group, rows[0]).map((categoryGroup) => ({
      category: categoryGroup.category,
      columnCount: categoryGroup.columns.length,
    }))).toEqual([
      { category: 'RX', columnCount: 2 },
      { category: 'SCALED', columnCount: 4 },
      { category: 'INTER', columnCount: 1 },
    ]);
  });

  it('exports each floor as a styled wave table', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const schedule = { id: 'schedule-main', name: 'Floor 1', startTime: '09:00', floor: 'main' as const };
    const wod = { id: 'wod-export', name: 'WOD export', duration: 10, teamsPerWave: 1, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: schedule.id };
    const team = { id: 'team-export', name: 'Équipe export', category: 'SCALED' as const };
    const generatedWod = generatedWodWithWaves(wod, [
      { number: 1, start: 540, end: 550, teams: [team.id], lanes: [{ lane: 5, teamId: team.id }], capacity: 1, lanePositions: [5] },
      { number: 2, start: 560, end: 570, teams: [], lanes: [], capacity: 1, lanePositions: [6] },
    ]);
    const columns = generatedWod.waves.map((wave: any) => ({ generatedWod, wave }));
    const track = {
      schedule,
      wods: [generatedWod],
      groups: [{ wod, categories: [{ category: 'SCALED', categories: ['SCALED'], columns }], columns }],
      columns,
    } as any;
    const saved = { ...savedSchedule('generated-export', 'Export coloré', '0hard/0soft'), tracks: [track] };
    const competition: Competition = {
      id: 'competition-export',
      name: 'Test export',
      date: '2026-08-15',
      schedules: [schedule],
      wods: [wod],
      teams: [team],
      pairedCategories: null,
      optimizedSchedules: [saved],
      activeScheduleId: saved.id,
    };
    const xlsx = await import('xlsx-js-style');
    const sheet = (app as any).buildExcelFloorSheet(xlsx, competition, saved, track);

    expect(sheet['!merges']).toContainEqual({ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } });
    expect(sheet['!merges']).toContainEqual({ s: { r: 5, c: 0 }, e: { r: 5, c: 1 } });
    expect(sheet['A1'].s.fill.fgColor.rgb).toBe('2F3C34');
    expect(sheet['A7'].v).toBe(5);
    expect(sheet['B7'].v).toBe(team.name);
    expect(sheet['B7'].s.fill.fgColor.rgb).toBe('E0EFD7');
    expect(sheet['D7'].v).toBe('');

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Floor 1');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    const parsed = xlsx.read(buffer, { type: 'buffer', cellStyles: true });
    expect(parsed.Sheets['Floor 1']['B7'].s.fgColor.rgb).toBe('E0EFD7');
  });

  it('blocks only a secondary-floor rest violation during a manual move', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance;
    const firebase = TestBed.inject(FirebaseService);
    const mainSchedule = { id: 'schedule-main', name: 'Floor 1', startTime: '09:00', floor: 'main' as const };
    const secondarySchedule = { id: 'schedule-secondary', name: 'Floor 2', startTime: '09:00', floor: 'secondary' as const };
    const mainWod = { id: 'wod-main', name: 'Main', duration: 10, teamsPerWave: 1, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: mainSchedule.id };
    const secondaryWod = { id: 'wod-secondary', name: 'Secondary', duration: 10, teamsPerWave: 1, waveInterval: 5, categoryInterval: 5, setupAfter: 5, scheduleId: secondarySchedule.id };
    const team = { id: 'team-1', name: 'Team 1', category: 'SCALED' as const };
    const mainGeneratedWod = generatedWodWithWaves(mainWod, [
      { number: 1, start: 540, end: 550, teams: [team.id], lanes: [{ lane: 5, teamId: team.id }], capacity: 1, lanePositions: [5] },
    ]);
    const secondaryGeneratedWod = generatedWodWithWaves(secondaryWod, [
      { number: 1, start: 660, end: 670, teams: [team.id], lanes: [{ lane: 1, teamId: team.id }], capacity: 1, lanePositions: [1] },
      { number: 2, start: 570, end: 580, teams: [], lanes: [], capacity: 1, lanePositions: [2] },
    ]);
    const mainTrack = generatedTrack(mainSchedule, mainGeneratedWod);
    const secondaryTrack = generatedTrack(secondarySchedule, secondaryGeneratedWod);
    const saved = {
      ...savedSchedule('generated-rest', 'Pause invalide', '0hard/0soft'),
      minimumRestMinutes: 60,
      tracks: [mainTrack, secondaryTrack],
    };
    const competition: Competition = {
      id: 'competition-rest',
      name: 'Test competition',
      date: '2026-08-15',
      schedules: [mainSchedule, secondarySchedule],
      wods: [mainWod, secondaryWod],
      teams: [team],
      pairedCategories: null,
      optimizedSchedules: [saved],
      activeScheduleId: saved.id,
    };

    firebase.competitions.set([competition]);
    app.selectedCompetitionId.set(competition.id);
    app.generatedSchedule.set(saved);
    const sourceColumn = { generatedWod: secondaryGeneratedWod, wave: secondaryGeneratedWod.waves[0] };
    const targetColumn = { generatedWod: secondaryGeneratedWod, wave: secondaryGeneratedWod.waves[1] };
    const event = dragEvent();

    app.startTeamDrag(event, secondaryTrack, sourceColumn, 1, team.id);
    app.dropTeam(event, secondaryTrack, targetColumn, 2);

    expect(app.scheduleEditError()).toContain('60 minutes');
    expect(app.generatedSchedule().tracks[1].wods[0].waves[0].lanes)
      .toEqual([{ lane: 1, teamId: team.id }]);
  });
});

function savedSchedule(id: string, name: string, score: string): SavedSchedule {
  return {
    id,
    name,
    tracks: [],
    algorithmVersion: 5,
    generatedAt: '2026-07-28T18:00:00Z',
    score,
  };
}

function generatedWodWithWaves(wod: any, waves: any[]): any {
  return {
    wod,
    category: 'SCALED',
    categories: ['SCALED'],
    start: Math.min(...waves.map((wave) => wave.start)),
    end: Math.max(...waves.map((wave) => wave.end)),
    waves,
  };
}

function generatedTrack(schedule: any, generatedWod: any): any {
  return { schedule, wods: [generatedWod], groups: [], columns: [] };
}

function dragEvent(): DragEvent {
  return { preventDefault: () => {}, dataTransfer: null } as unknown as DragEvent;
}
