// Provider factory. MOCK_MODE=true switches every provider to its mock.

import { getConfig } from "@/lib/config";
import type { Providers } from "@/lib/providers/types";
import { createMockProviders } from "@/lib/providers/mock";
import { createRealProviders } from "@/lib/providers/real";

const g = globalThis as unknown as { __civicscribeProviders?: Providers };

export function getProviders(): Providers {
  if (!g.__civicscribeProviders) {
    const config = getConfig();
    g.__civicscribeProviders = config.mockMode
      ? createMockProviders()
      : createRealProviders(config);
  }
  return g.__civicscribeProviders;
}
