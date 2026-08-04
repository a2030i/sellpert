import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

const SERIOUS_IMPACTS = new Set(['critical', 'serious'])

export async function expectNoSeriousAccessibilityViolations(page: Page, context: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  const violations = result.violations
    .filter(violation => violation.impact && SERIOUS_IMPACTS.has(violation.impact))
    .map(violation => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map(node => ({
        targets: node.target.map(target => String(target)),
        html: node.html,
        summary: node.failureSummary,
      })),
    }))

  expect(violations, `${context} contains serious WCAG accessibility violations`).toEqual([])
}
