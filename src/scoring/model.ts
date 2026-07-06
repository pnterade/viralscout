import { FEATURE_NAMES } from './features';

export interface ModelJSON {
  weights: Record<string, number>;
  bias: number;
  mean: Record<string, number>;
  std: Record<string, number>;
  samples: number;
  trainedAt: string;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Logistic-regression virality classifier with built-in feature standardization.
 * Pure TS so there are no native deps to compile on Windows.
 */
export class Model {
  weights: Record<string, number>;
  bias: number;
  mean: Record<string, number>;
  std: Record<string, number>;
  samples: number;

  constructor(json?: Partial<ModelJSON>) {
    this.weights = json?.weights || Object.fromEntries(FEATURE_NAMES.map((n) => [n, 0]));
    this.bias = json?.bias ?? 0;
    this.mean = json?.mean || Object.fromEntries(FEATURE_NAMES.map((n) => [n, 0]));
    this.std = json?.std || Object.fromEntries(FEATURE_NAMES.map((n) => [n, 1]));
    this.samples = json?.samples ?? 0;
  }

  private z(f: Record<string, number>): number {
    let s = this.bias;
    for (const n of FEATURE_NAMES) {
      const x = ((f[n] ?? 0) - this.mean[n]) / (this.std[n] || 1);
      s += (this.weights[n] || 0) * x;
    }
    return s;
  }

  predict(f: Record<string, number>): number {
    return sigmoid(this.z(f));
  }

  toJSON(): ModelJSON {
    return {
      weights: this.weights,
      bias: this.bias,
      mean: this.mean,
      std: this.std,
      samples: this.samples,
      trainedAt: new Date().toISOString(),
    };
  }

  static train(
    rows: { features: Record<string, number>; label: number }[],
    opts?: { epochs?: number; lr?: number; l2?: number },
  ): Model {
    const epochs = opts?.epochs ?? 400;
    const lr = opts?.lr ?? 0.1;
    const l2 = opts?.l2 ?? 0.001;

    const m = new Model();
    m.samples = rows.length;

    // Standardize each feature (mean 0, std 1) for stable gradient descent.
    for (const n of FEATURE_NAMES) {
      const vals = rows.map((r) => r.features[n] ?? 0);
      const mean = vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
      const varr = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(vals.length, 1);
      m.mean[n] = mean;
      m.std[n] = Math.sqrt(varr) || 1;
    }

    const N = Math.max(rows.length, 1);
    for (let e = 0; e < epochs; e++) {
      const gw: Record<string, number> = Object.fromEntries(FEATURE_NAMES.map((n) => [n, 0]));
      let gb = 0;
      for (const r of rows) {
        const err = m.predict(r.features) - r.label;
        gb += err;
        for (const n of FEATURE_NAMES) {
          const x = ((r.features[n] ?? 0) - m.mean[n]) / (m.std[n] || 1);
          gw[n] += err * x;
        }
      }
      m.bias -= (lr * gb) / N;
      for (const n of FEATURE_NAMES) {
        m.weights[n] -= lr * (gw[n] / N + l2 * m.weights[n]);
      }
    }
    return m;
  }
}
