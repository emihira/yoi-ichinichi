// LINE に送るメッセージの組み立て（仕様書 §4.3, §5.3, §6, §7.2, §8.3）
// 文字の大きさ・ボタンの大きさは、親御さんの実機テストで調整する（§4.3 補足）。

import { POSTBACK_OK, POSTBACK_UNWELL, POSTBACK_UNWELL_CANCEL } from '../rules';
import type { LineMessage } from './client';

export function text(t: string): LineMessage {
  return { type: 'text', text: t };
}

/** 朝の挨拶（reminder=true でリマインド）。声での返信を主役にし、ボタンは補助 */
export function morningMessage(greeting: string, reminder = false): LineMessage {
  const body: Record<string, unknown>[] = [
    { type: 'text', text: greeting, size: 'xl', weight: 'bold', wrap: true },
  ];
  if (reminder) {
    body.push({ type: 'text', text: 'お返事がまだのようです。', size: 'lg', wrap: true, margin: 'md' });
  }
  body.push(
    { type: 'separator', margin: 'lg' },
    { type: 'text', text: '声でひとこと、お返事してくださいね。', size: 'lg', wrap: true, margin: 'lg' },
    { type: 'text', text: '下のマイクのボタンでお話しできます。', size: 'md', wrap: true, margin: 'sm' },
  );

  return {
    type: 'flex',
    altText: reminder ? 'お返事がまだのようです。' : greeting,
    contents: {
      type: 'bubble',
      size: 'giga',
      body: { type: 'box', layout: 'vertical', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'md',
            contents: [
              button('😊 げんきです', POSTBACK_OK, 'げんきです', 'primary'),
              button('😢 ぐあいがわるい', POSTBACK_UNWELL, 'ぐあいがわるい', 'secondary'),
            ],
          },
          {
            type: 'text',
            text: '「ぐあいがわるい」を押すと、ご家族にお知らせします。',
            size: 'sm',
            color: '#666666',
            wrap: true,
          },
        ],
      },
    },
  };
}

function button(label: string, data: string, displayText: string, style: 'primary' | 'secondary') {
  return {
    type: 'button',
    style,
    height: 'md',
    action: { type: 'postback', label, data, displayText },
  };
}

export const THANKS = text('今日も良い一日となりますように');

export function unwellAckMessage(): LineMessage {
  return {
    type: 'text',
    text: 'ご家族にお知らせしました。いそぐときは119に電話してください。',
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'postback',
            label: 'まちがえて押しました',
            data: POSTBACK_UNWELL_CANCEL,
            displayText: 'まちがえて押しました',
          },
        },
      ],
    },
  };
}

export const UNWELL_ALL_FAILED = text(
  'お知らせがとどきませんでした。ご家族に電話してください。いそぐときは119に電話してください。',
);
export const UNWELL_RECENTLY_SENT = text(
  'さきほどご家族にお知らせしました。いそぐときは119に電話してください。',
);

// ---- 家族への通知 ----

export function familyNoReply(name: string): LineMessage {
  return text(`${name}さんから、けさのお返事がまだありません。お電話で確認してみてください。`);
}

export function familyMorningFailed(name: string): LineMessage {
  return text(`${name}さんへの、けさのメッセージを送れませんでした。お電話で確認してみてください。`);
}

export function familyUnwell(name: string, clock: string): LineMessage {
  return text(`${name}さんが『ぐあいがわるい』を押しました（${clock}）。お電話で様子を確かめてください。`);
}
