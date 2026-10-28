// Pure seed specs: no database, no Node APIs. The server seeds them through the Store, the demo reads them directly.

export type Spec = {
  title: string;
  summary?: string;
  notes?: string;
  tags?: string[];
  questions?: string[];
  children?: Spec[];
  label?: string;
};

export type DemoSpec = { title: string; description: string; root: Spec; links?: [string, string, string?][] };

export const DEMOS: DemoSpec[] = [
  {
    title: 'Learning Transformers (sample)',
    description: 'SAMPLE DATA: a small example map about how transformer models work.',
    root: {
      title: 'Transformers',
      summary: 'Neural network architecture built around attention, behind most modern language models.',
      tags: ['sample', 'ml'],
      children: [
        {
          title: 'Self-Attention',
          summary: 'Each token weighs every other token to build a context-aware representation.',
          questions: ['Why does attention scale quadratically with sequence length?'],
          children: [
            { title: 'Queries, Keys, Values', summary: 'Three learned projections that drive the attention score.' },
            { title: 'Multi-Head Attention', summary: 'Several attention patterns computed in parallel and combined.' },
            { title: 'Causal Masking', summary: 'Prevents a token from attending to future tokens during training.' },
          ],
        },
        {
          title: 'Positional Encoding',
          summary: 'Injects word order, since attention alone is order-blind.',
          children: [
            { title: 'Sinusoidal Encoding', summary: 'Fixed sine and cosine patterns from the original paper.' },
            { title: 'Rotary Embeddings', summary: 'Encodes relative position by rotating query and key vectors.' },
          ],
        },
        {
          title: 'Architecture Blocks',
          summary: 'The repeated layers that make up the model.',
          children: [
            { title: 'Feed-Forward Layer', summary: 'Per-token MLP applied after attention in each block.' },
            { title: 'Residual Connections', summary: 'Skip paths that keep gradients healthy in deep stacks.' },
            { title: 'Layer Normalization', summary: 'Stabilizes activations between sublayers.' },
          ],
        },
        {
          title: 'Training',
          summary: 'How the weights are learned.',
          children: [
            { title: 'Next-Token Prediction', summary: 'Self-supervised objective used by decoder-only models.' },
            { title: 'Scaling Laws', summary: 'Loss improves predictably with more data, parameters and compute.' },
          ],
        },
        { title: 'Tokenization', summary: 'Splitting text into subword units the model can embed.' },
      ],
    },
    links: [
      ['Causal Masking', 'Next-Token Prediction', 'enables'],
      ['Tokenization', 'Positional Encoding', 'feeds into'],
    ],
  },
];

/** The map the Living Mindmap demo shows. Sample content, not a real project. */
export const SUPPORT_INBOX: DemoSpec = {
  title: 'Planning a support-inbox assistant',
  description: 'SAMPLE CONTENT: a made-up planning map, not a real project.',
  root: {
    title: 'Support-inbox assistant',
    summary: 'An assistant that drafts replies to customer email for a person to review.',
    tags: ['sample'],
    children: [
      {
        title: 'Goals and scope',
        summary: 'Who it helps and what counts as done.',
        children: [
          { title: 'Response-time target', summary: 'How fast a first reply should arrive.' },
          { title: 'What it must not do', summary: 'Refunds, legal advice, and anything a person must decide.' },
        ],
      },
      {
        title: 'Ticket triage',
        summary: 'Sort each message before anyone drafts.',
        children: [
          { title: 'Categories and priority', summary: 'A short list of ticket types and an urgency order.' },
          { title: 'Escalation to a person', summary: 'When the assistant stops and hands over.' },
        ],
      },
      {
        title: 'Drafting replies',
        summary: 'Turn a ticket and the help center into a first draft.',
        children: [
          { title: 'Tone and style guide', summary: 'How replies should sound.' },
          { title: 'Canned answers', summary: 'Approved text for common questions.' },
        ],
      },
      {
        title: 'Knowledge base',
        summary: 'What the drafts may quote.',
        children: [
          { title: 'Help-center articles', summary: 'Public pages the assistant can cite.' },
          { title: 'Past resolved tickets', summary: 'Earlier answers that worked.' },
        ],
      },
      {
        title: 'Measuring quality',
        summary: 'How the team knows drafts are good.',
        children: [{ title: 'Reviewer feedback', summary: 'Accept, edit, or reject, with a reason.' }],
      },
    ],
  },
};
