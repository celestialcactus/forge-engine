export interface SmartCrusherConfig {
  minTokensToCrush?: number;
  maxItemsAfterCrush?: number;
  preserveErrors?: boolean;
}

export class SmartCrusher {
  private config: Required<SmartCrusherConfig>;

  constructor(config: SmartCrusherConfig = {}) {
    this.config = {
      minTokensToCrush: config.minTokensToCrush ?? 200,
      maxItemsAfterCrush: config.maxItemsAfterCrush ?? 50,
      preserveErrors: config.preserveErrors ?? true,
    };
  }

  /**
   * Compresses a JSON array by sampling and removing redundancies.
   */
  crush(content: string, ccrHash: string): string | null {
    try {
      const arr = JSON.parse(content);
      if (!Array.isArray(arr) || arr.length <= this.config.maxItemsAfterCrush) {
        return null; // Not worth crushing
      }

      const totalItems = arr.length;
      
      // 1. Find and preserve anomalies (errors/warnings)
      const anomalies = this.config.preserveErrors 
        ? arr.filter(item => this.isAnomaly(item))
        : [];
      
      // 2. Calculate remaining quota
      const quotaForSampling = Math.max(0, this.config.maxItemsAfterCrush - anomalies.length);
      
      // 3. Sample: 30% from start, 15% from end, 55% from middle (stride)
      let sampled: any[] = [];
      if (quotaForSampling > 0) {
        const numStart = Math.floor(quotaForSampling * 0.3);
        const numEnd = Math.floor(quotaForSampling * 0.15);
        const numMiddle = quotaForSampling - numStart - numEnd;
        
        const startItems = arr.slice(0, numStart);
        const endItems = arr.slice(-numEnd);
        
        const remainingMiddle = arr.slice(numStart, -numEnd);
        const middleStride = Math.max(1, Math.floor(remainingMiddle.length / numMiddle));
        const middleItems = remainingMiddle.filter((_, i) => i % middleStride === 0).slice(0, numMiddle);
        
        sampled = [...startItems, ...middleItems, ...endItems];
      }
      
      // 4. Combine and deduplicate anomalies and sampled
      const finalSet = Array.from(new Set([...anomalies, ...sampled]));
      
      // 5. Emit payload
      return JSON.stringify({
        _crushed_meta: `[${totalItems} items compressed to ${finalSet.length}. Retrieve full content using tool: ccr_retrieve with hash=${ccrHash}]`,
        _anomalies_preserved: anomalies.length,
        items: finalSet
      });
      
    } catch {
      return null;
    }
  }

  private isAnomaly(item: any): boolean {
    const str = JSON.stringify(item).toLowerCase();
    return str.includes('error') || str.includes('warn') || str.includes('fail') || str.includes('exception');
  }
}
