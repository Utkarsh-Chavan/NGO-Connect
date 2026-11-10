import { ApiResponse } from '../auth/auth.models';
import { Need } from '../needs/need.models';

export type MatchingRecommendation = Omit<Need, 'ngo_id'> & {
  score: number;
  reasons: string[];
};

export interface MatchingRecommendationsData {
  items: MatchingRecommendation[];
  pagination: { limit: number; offset: number; total: number };
}

export type MatchingRecommendationsResponse = ApiResponse<MatchingRecommendationsData>;
