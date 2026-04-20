/**
 * 同步模型 API
 */

import { apiClient } from './client';

export const syncModelsApi = {
  sync: (name: string = 'us-ci') =>
    apiClient.post('/v0/management/openai-compatibility/sync-models', { name }),
};
