import { useSyncExternalStore } from 'react';
import { findByFuzzyTitle } from '../../vessels/find-by-fuzzy-title';

export interface Email {
  readonly id: string;
  readonly subject: string;
  readonly senderName: string;
  readonly senderEmail: string;
  readonly receivedLabel: string;
  readonly preview: string;
  readonly paragraphs: readonly string[];
}

export interface MailState {
  readonly emails: readonly Email[];
  readonly selectedEmailId: string;
}

export const SEED_EMAILS: readonly Email[] = [
  {
    id: 'bakery-order',
    subject: 'Your sourdough order is ready',
    senderName: 'Rosie at Crumb & Co.',
    senderEmail: 'hello@crumbandco.example',
    receivedLabel: '9:12 AM',
    preview: 'Good morning! Your Saturday order is wrapped and waiting.',
    paragraphs: [
      'Good morning! Your Saturday order is wrapped and waiting for you on the shelf by the window: one country sourdough, a half dozen cardamom buns, and the rye loaf you asked us to slice.',
      'We open at seven and the buns are still warm until about nine, so come early if you can. If someone else is picking up, just have them mention your name at the counter.',
      'A small heads up: we are trying a new honey oat loaf next week. If you would like one set aside with your usual order, reply to this email and we will add it.',
      'Thanks for baking with us every week. It honestly makes our Saturdays.',
    ],
  },
  {
    id: 'book-club',
    subject: 'Book club moves to Thursday',
    senderName: 'Priya Nair',
    senderEmail: 'priya.nair@example.com',
    receivedLabel: '8:40 AM',
    preview: 'Quick change of plans, we are meeting Thursday instead.',
    paragraphs: [
      'Quick change of plans, we are meeting Thursday at 7 instead of Wednesday. Same place, my living room, and I will have tea and the good biscuits.',
      'We are finishing the last four chapters. No spoilers in the group chat please!',
    ],
  },
  {
    id: 'beach-photo',
    subject: 'Look what we found at the beach',
    senderName: 'Tom Becker',
    senderEmail: 'tom.becker@example.com',
    receivedLabel: 'Yesterday',
    preview: 'The kids found a starfish and insisted I send you a photo.',
    paragraphs: [
      'The kids found a starfish and insisted I send you a photo right away. It went straight back into the water afterwards, do not worry.',
      'Hope you can join us next time. The weather was perfect.',
    ],
  },
  {
    id: 'dentist',
    subject: 'Appointment reminder for Tuesday',
    senderName: 'Brightside Dental',
    senderEmail: 'reminders@brightsidedental.example',
    receivedLabel: 'Yesterday',
    preview: 'This is a friendly reminder of your checkup on Tuesday.',
    paragraphs: [
      'This is a friendly reminder of your checkup on Tuesday at 10:30 AM with Dr. Alvarez.',
      'Please arrive five minutes early. If you need to reschedule, call us or reply to this email.',
    ],
  },
  {
    id: 'garden-newsletter',
    subject: 'October in the garden',
    senderName: 'Green Thumb Weekly',
    senderEmail: 'newsletter@greenthumb.example',
    receivedLabel: 'Mon',
    preview: 'Time to plant tulip bulbs and tuck in your herbs for winter.',
    paragraphs: [
      'Time to plant tulip bulbs and tuck in your herbs for winter. This week we cover mulching, saving seeds, and which plants enjoy the first frost.',
    ],
  },
  {
    id: 'package-delivery',
    subject: 'Your package arrives today',
    senderName: 'Parcel Post',
    senderEmail: 'tracking@parcelpost.example',
    receivedLabel: 'Mon',
    preview: 'Your package is out for delivery and should arrive by 6 PM.',
    paragraphs: [
      'Your package is out for delivery and should arrive by 6 PM. If nobody is home, the driver will leave it with your neighbor.',
    ],
  },
  {
    id: 'running-club',
    subject: 'Sunday morning run',
    senderName: 'Lena Fischer',
    senderEmail: 'lena.fischer@example.com',
    receivedLabel: 'Sun',
    preview: 'Easy 5k along the river, meeting at the bridge at 8.',
    paragraphs: [
      'Easy 5k along the river this Sunday, meeting at the bridge at 8. Coffee afterwards for anyone who wants it.',
    ],
  },
  {
    id: 'library',
    subject: 'Your library books are due soon',
    senderName: 'City Library',
    senderEmail: 'notices@citylibrary.example',
    receivedLabel: 'Sat',
    preview: 'Two items are due back next Friday. You can renew online.',
    paragraphs: [
      'Two items are due back next Friday. You can renew them online or at any branch.',
    ],
  },
];

const listeners = new Set<() => void>();
let state: MailState = initialMailState();

export function useMailStore(): MailState {
  return useSyncExternalStore(subscribe, getMailSnapshot, getMailSnapshot);
}

export function getMailSnapshot(): MailState {
  return state;
}

export function selectedEmail(mailState: MailState): Email | undefined {
  return mailState.emails.find(
    (email) => email.id === mailState.selectedEmailId,
  );
}

export function __resetMailStoreForTests(): void {
  setState(initialMailState());
}

export const mailActions = {
  selectEmail(id: string): void {
    if (!state.emails.some((email) => email.id === id)) return;
    setState({ ...state, selectedEmailId: id });
  },
  openEmail(subject: string): Email | undefined {
    const match = findByFuzzyTitle(
      state.emails.map((email) => ({ ...email, title: email.subject })),
      subject,
    );
    if (!match) return undefined;
    setState({ ...state, selectedEmailId: match.id });
    return state.emails.find((email) => email.id === match.id);
  },
};

function initialMailState(): MailState {
  return { emails: SEED_EMAILS, selectedEmailId: SEED_EMAILS[0]?.id ?? '' };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: MailState): void {
  state = next;
  for (const listener of listeners) listener();
}
