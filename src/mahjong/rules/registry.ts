import { basic } from './basic';
import { register, type Rules, type RulesetMetadata } from './contract';
import { guangdong } from './guangdong';
import { sichuan } from './sichuan';

export function createRulesetRegistry(defaultId: string, entries: readonly Rules<unknown>[]) {
  const current = new Map<string, Rules<unknown>>();
  const versions = new Map<string, Rules<unknown>>();
  for (const rules of entries) {
    const key = `${rules.id}@${rules.version}`;
    if (versions.has(key)) throw new Error(`重复的玩法版本: ${key}`);
    versions.set(key, rules);
    const latest = current.get(rules.id);
    if (!latest || latest.version < rules.version) current.set(rules.id, rules);
  }
  const defaultRule = current.get(defaultId);
  if (!defaultRule) throw new Error(`默认玩法未注册: ${defaultId}`);

  return {
    defaultRule,
    getCurrent: (id: string) => current.get(id),
    get: (id: string, version: number) => versions.get(`${id}@${version}`),
    catalog: (): RulesetMetadata[] => [...current.values()].map(({ id, name, version, seats }) => ({
      id, name, version, seats,
    })),
  };
}

export const rulesets = createRulesetRegistry(basic.id, [register(basic), register(sichuan), register(guangdong)]);
