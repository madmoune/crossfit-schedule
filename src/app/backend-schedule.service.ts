import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import type { Competition } from './app';

export interface BackendSchedulePayload {
  resolutionStatus: string;
  generatedAt: string;
  score: string;
  scoreDetails: { hard: number; soft: number };
  solver: { status: string; timeLimitSeconds: number; elapsedMilliseconds: number };
  summary: {
    teamCount: number;
    workoutCount: number;
    timeSlotCount: number;
    assignmentCount: number;
    minimumRestMinutes: number;
    targetPauseLowerMinutes: number;
    targetPauseUpperMinutes: number;
    mainFinish: string | null;
    secondaryFinish: string | null;
  };
  assignments: BackendScheduleAssignment[];
  warnings: string[];
}

export interface BackendScheduleAlternative extends BackendSchedulePayload {
  rank: number;
}

export interface BackendScheduleResponse extends BackendSchedulePayload {
  competitionId: string;
  cached: boolean;
  alternatives: BackendScheduleAlternative[];
}

export interface BackendScheduleAssignment {
  id: string;
  team: { id: string; name: string; category: string };
  workout: {
    id: string;
    name: string;
    durationMinutes: number;
    teamsPerWave: number;
    waveInterval: number;
    categoryInterval: number;
    setupAfter: number;
    scheduleId: string;
  };
  timeSlot: {
    id: string;
    name: string;
    start: string;
    end: string;
    laneCount: number;
    scheduleId: string;
    scheduleName: string;
    floor: 'main' | 'secondary';
    workoutId: string;
    allowedCategories: string[];
    waveNumber: number;
    categoryGroupIndex: number;
    lanePositions: number[];
  };
  lane: number;
  start: string;
  end: string;
  restAfterMinutes: number | null;
}

@Injectable({ providedIn: 'root' })
export class BackendScheduleService {
  private readonly http = inject(HttpClient);

  optimize(competition: Competition, alternativeCount = 3): Promise<BackendScheduleResponse> {
    const request = {
      competitionId: competition.id,
      competitionName: competition.name,
      date: competition.date,
      schedules: competition.schedules,
      teams: competition.teams,
      wods: competition.wods.map((wod) => ({
        id: wod.id,
        name: wod.name,
        duration: wod.duration,
        teamsPerWave: wod.teamsPerWave,
        waveInterval: wod.waveInterval,
        categoryInterval: wod.categoryInterval,
        setupAfter: wod.setupAfter,
        scheduleId: wod.scheduleId,
        eligibleCategories: [],
      })),
      pairedCategories: competition.pairedCategories ?? [],
      resolutionSeconds: 10,
      minimumRestMinutes: 60,
      alternativeCount,
    };

    return firstValueFrom(this.http.post<BackendScheduleResponse>(
      `${environment.backendUrl}/api/schedules/optimize`,
      request,
    ));
  }
}
