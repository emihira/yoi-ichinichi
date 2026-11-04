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

export function familyUnwellCancelled(name: string, clock: string): LineMessage {
  return text(`${name}さんの『ぐあいがわるい』は押しまちがいでした（${clock}に取り消し）。`);
}

export const UNWELL_CANCELLED = text('取り消しました。今日も良い一日となりますように');

// ---- 登録（§9） ----

export const ASK_INVITE_CODE = text('招待コードを送ってください。');

export const FAMILY_NOTICE =
  'このサービスは、ご家族の見守りを補助するものです。緊急通報や安否を保証するサービスではありません。\n\n' +
  '通信障害やLINEの送信上限などにより、通知が届かない場合があります。また、送信に失敗したこと自体をお知らせできない場合もあります。\n\n' +
  '緊急時は直接ご家族に連絡するか、必要に応じて119番などの緊急通報をご利用ください。';

export function usageText(isAdmin: boolean): LineMessage {
  const lines = [
    '【つかいかた】次の言葉を送ってください。',
    '',
    'ようす：親御さんの今日のようすと、この7日間の返信',
    'おやすみ：見守りを一時休止',
    'さいかい：休止をやめて、翌朝から再開',
    'じかん：朝のメッセージの時刻を変える',
    'なまえ：親御さんの呼び名を変える',
    'つかいかた：この案内',
  ];
  if (isAdmin) lines.push('', '（管理者のみ）', 'しょうたい：ご家族・親御さんを招待');
  return text(lines.join('\n'));
}

export function inviteChoice(): LineMessage {
  return {
    type: 'text',
    text: 'どなたを招待しますか？',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'postback', label: '家族を招待', data: 'action=invite_family', displayText: '家族を招待' } },
        { type: 'action', action: { type: 'postback', label: '親を招待', data: 'action=invite_parent', displayText: '親を招待' } },
      ],
    },
  };
}
