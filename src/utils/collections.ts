import { getCollection } from 'astro:content';
import { topics } from './urls';

export async function getDocuments() {
  const entries = await getCollection('documents');
  const topicOrder = new Map<string, number>(topics.map((topic, index) => [topic, index]));
  return entries.sort((a, b) => topicOrder.get(a.data.topic)! - topicOrder.get(b.data.topic)! || a.data.order - b.data.order);
}

export function topicName(title: string) {
  return title.replace(/(?:共通知識索引|知識索引|共通知識)$/, '').trim();
}
