import type { Profile } from '@tracker/contracts';
import { emptyState, type State, type StoredProblem, type StoredRevision } from './state.js';

const date = '2026-10-01T09:00:00.000Z';
export const demoProfiles: Profile[] = [
  {
    id: 'demo-alex',
    username: 'alexchen',
    displayName: 'Alex Chen',
    bio: 'Curious about the things that make technology work.',
    expertise: ['Windows', 'Hardware'],
    role: 'member',
    restricted: false,
    createdAt: date,
  },
  {
    id: 'demo-sam',
    username: 'samrivera',
    displayName: 'Sam Rivera',
    bio: 'Software tinkerer. Testing fixes and sharing what works.',
    expertise: ['Linux', 'Networking'],
    role: 'member',
    restricted: false,
    createdAt: date,
  },
  {
    id: 'demo-morgan',
    username: 'morganlee',
    displayName: 'Morgan Lee',
    bio: 'Community moderator. Evidence makes better answers.',
    expertise: ['Troubleshooting'],
    role: 'admin',
    restricted: false,
    createdAt: date,
  },
];
export function seedState(): State {
  const s = emptyState();
  s.profiles = structuredClone(demoProfiles);
  const specs: Array<
    Partial<StoredProblem> & Pick<StoredProblem, 'id' | 'title' | 'category' | 'product'>
  > = [
    {
      id: 'demo-wifi',
      title: 'Wi-Fi disconnects every few minutes after waking from sleep',
      category: 'Networking',
      product: 'Intel AX210',
      status: 'Confirmed',
      description:
        'After waking my laptop from sleep, Wi-Fi drops every few minutes. Reconnecting works briefly, but the connection becomes unstable again.',
      setup: 'Windows 11 24H2 · Intel AX210 · driver 23.80',
      symptoms: 'Connected, no internet. Repeats after wake.',
      steps: 'Put the laptop to sleep for 10 minutes, wake it, then stream a video.',
      attemptedFixes: 'Restarted the router and reinstalled the current Wi-Fi driver.',
      tags: ['Wi-Fi', 'Windows 11', 'Sleep mode'],
    },
    {
      id: 'demo-display',
      title: 'External monitor flickers when connected through a USB-C dock',
      category: 'Computers',
      product: 'USB-C display dock',
      status: 'Investigating',
      setup: 'Dell XPS 13 · 144 Hz external display',
      description:
        'My external display flashes black intermittently while connected through a USB-C dock. The laptop screen remains stable and the problem gets worse at higher refresh rates.',
      tags: ['USB-C', 'Display', 'Hardware'],
    },
    {
      id: 'demo-browser',
      title: 'Browser uses excessive memory after reopening saved tabs',
      category: 'Software',
      product: 'Chromium browser',
      status: 'Reported',
      description:
        'Reopening a saved session of twelve tabs causes memory use to climb steadily, even after closing the tabs. The issue seems related to an extension.',
      setup: 'Ubuntu 24.04 · Chromium 130',
      tags: ['Browser', 'Memory', 'Linux'],
    },
    {
      id: 'demo-bluetooth',
      title: 'Bluetooth audio stutters when a second device is connected',
      category: 'Computers',
      product: 'Bluetooth headphones',
      status: 'Partially solved',
      description:
        'Audio cuts out for a moment whenever I move the Bluetooth mouse. The headphones sound fine when the mouse is disconnected.',
      setup: 'Windows 11 · Bluetooth 5.2 headset',
      tags: ['Bluetooth', 'Audio'],
    },
    {
      id: 'demo-dns',
      title: 'DNS lookups fail after switching between home and office networks',
      category: 'Networking',
      product: 'NetworkManager',
      status: 'Resolved',
      resolvedAt: date,
      description:
        'Websites stop loading after switching networks because DNS retains the previous network resolver. Other devices on the same network keep working.',
      setup: 'Ubuntu 24.04 · NetworkManager',
      tags: ['DNS', 'Linux', 'Networking'],
    },
    {
      id: 'demo-editor',
      title: 'Code editor freezes when searching a large project folder',
      category: 'Software',
      product: 'Code editor',
      description:
        'Searching across a workspace with generated dependencies makes the editor freeze. Excluding dependency directories improves the situation but does not fully eliminate it.',
      setup: 'macOS 15 · project with 60,000 files',
      tags: ['Developer tools', 'Performance'],
    },
  ];
  for (const [i, x] of specs.entries()) {
    s.problems.push({
      authorId: i % 2 ? 'demo-sam' : 'demo-alex',
      classification: x.category === 'Computers' ? 'Hardware' : 'Software',
      description: '',
      setup: '',
      symptoms: '',
      steps: '',
      attemptedFixes: '',
      tags: [],
      status: 'Reported',
      canonicalId: null,
      hidden: false,
      demo: true,
      createdAt: new Date(Date.parse(date) - i * 86400000).toISOString(),
      updatedAt: date,
      resolvedAt: null,
      version: 1,
      ...x,
    } as StoredProblem);
    s.timeline.push({
      id: `demo-event-${i}`,
      problemId: x.id,
      actorId: null,
      kind: 'reported',
      fromStatus: null,
      toStatus: x.status ?? 'Reported',
      reason: 'Illustrative demonstration report.',
      createdAt: date,
    });
    const users = i === 2 ? ['demo-alex'] : ['demo-alex', 'demo-sam'];
    for (const user of users) {
      s.participation.push({
        id: `${x.id}-${user}-affected`,
        problemId: x.id,
        userId: user,
        kind: 'affected',
        setup: x.setup ?? 'Demonstration setup',
        createdAt: date,
      });
      s.participation.push({
        id: `${x.id}-${user}-vote`,
        problemId: x.id,
        userId: user,
        kind: 'vote',
        setup: '',
        createdAt: date,
      });
    }
  }
  for (const [i, pid] of ['demo-wifi', 'demo-bluetooth', 'demo-dns'].entries()) {
    const sid = `demo-solution-${i}`,
      rid = `demo-revision-${i}`;
    s.solutions.push({
      id: sid,
      problemId: pid,
      authorId: 'demo-sam',
      hidden: false,
      demo: true,
      createdAt: date,
      updatedAt: date,
    });
    const rev: StoredRevision = {
      id: rid,
      solutionId: sid,
      number: 1,
      title:
        i === 0
          ? 'Disable power saving for the wireless adapter'
          : i === 1
            ? 'Try a different USB port for your Bluetooth adapter'
            : 'Reconnect the resolver after switching networks',
      instructions:
        i === 0
          ? 'Open Device Manager, find the wireless adapter, and open Properties. In Power Management, clear “Allow the computer to turn off this device to save power.” Restart and test sleep and wake again.'
          : i === 1
            ? 'Move the Bluetooth adapter away from USB 3 devices using a short extension cable. Test audio with both devices connected.'
            : 'Check the active resolver configuration. Reconnect the affected network in NetworkManager, then confirm that DNS queries use the current network. Record the old settings before changing anything.',
      reasoning:
        'This is an illustrative fix for demonstrating the testing workflow. Confirm applicability before making changes.',
      supportedSetup: s.problems.find((p) => p.id === pid)!.setup,
      limitations:
        'Demonstration only; individual devices and software versions may behave differently.',
      warnings: 'Save your work and record current settings before changing them.',
      createdAt: date,
    };
    s.revisions.push(rev);
    s.tests.push({
      id: `demo-test-${i}`,
      revisionId: rid,
      userId: 'demo-alex',
      outcome: 'Worked',
      setup: rev.supportedSetup,
      evidence: 'Illustrative successful community test.',
      createdAt: date,
      updatedAt: date,
    });
    if (i > 0)
      s.verifications.push({
        id: `demo-verification-${i}`,
        revisionId: rid,
        reviewerId: 'demo-morgan',
        decision: 'verified',
        evidence: 'Illustrative moderator evidence, for demonstration only.',
        supportedScope: rev.supportedSetup,
        reason: 'The demonstration test supports the stated setup.',
        createdAt: date,
      });
  }
  s.comments.push({
    id: 'demo-comment-1',
    problemId: 'demo-wifi',
    authorId: 'demo-sam',
    body: 'Does this also happen on battery power? Please include your driver version so we can compare setups.',
    hidden: false,
    createdAt: date,
  });
  return s;
}
