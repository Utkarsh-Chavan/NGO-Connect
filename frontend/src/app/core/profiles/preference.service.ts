import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../auth/auth.models';

const apiUrl = environment.apiBaseUrl.replace(/\/$/, '');
export interface CatalogItem { cause_id?: string; skill_id?: string; name: string; description: string | null; is_active: boolean; }
export interface SelectedSkill extends CatalogItem { skill_id: string; proficiency_level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT'; }
export interface IndividualPreferences { causes: CatalogItem[]; skills: SelectedSkill[]; }

@Injectable({ providedIn: 'root' })
export class PreferenceService {
  private readonly http = inject(HttpClient);
  get() { return this.http.get<ApiResponse<IndividualPreferences>>(`${apiUrl}/users/me/preferences`); }
  causes() { return this.http.get<ApiResponse<CatalogItem[]>>(`${apiUrl}/causes`); }
  skills() { return this.http.get<ApiResponse<CatalogItem[]>>(`${apiUrl}/skills`); }
  addCause(causeId: string) { return this.http.post<ApiResponse<unknown>>(`${apiUrl}/users/me/causes`, { causeId }); }
  removeCause(causeId: string) { return this.http.delete<ApiResponse<unknown>>(`${apiUrl}/users/me/causes/${encodeURIComponent(causeId)}`); }
  addSkill(skillId: string, proficiencyLevel: SelectedSkill['proficiency_level']) { return this.http.post<ApiResponse<unknown>>(`${apiUrl}/users/me/skills`, { skillId, proficiencyLevel }); }
  updateSkill(skillId: string, proficiencyLevel: SelectedSkill['proficiency_level']) { return this.http.put<ApiResponse<unknown>>(`${apiUrl}/users/me/skills/${encodeURIComponent(skillId)}`, { proficiencyLevel }); }
  removeSkill(skillId: string) { return this.http.delete<ApiResponse<unknown>>(`${apiUrl}/users/me/skills/${encodeURIComponent(skillId)}`); }
}
