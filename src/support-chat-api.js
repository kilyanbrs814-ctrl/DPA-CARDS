export function supportError(error) {
  const value = String(error?.message || '') + ' ' + String(error?.code || '');
  if (/support_rate_limited/.test(value)) return 'Vous avez envoyé plusieurs messages. Réessayez dans une minute.';
  if (/support_forbidden|42501|JWT|session_changed|not_authenticated/.test(value)) return 'Votre accès a changé. Reconnectez-vous pour retrouver vos messages.';
  if (/invalid_support_subject/.test(value)) return 'Indiquez un objet de 3 à 140 caractères.';
  if (/invalid_support_message|23514/.test(value)) return 'Votre message doit contenir de 1 à 5 000 caractères.';
  if (/support_request_conflict/.test(value)) return 'Modifiez le message avant de réessayer.';
  return 'Impossible de charger ou d’envoyer les messages. Votre texte est conservé. Réessayez.';
}

export function mergeMessages(previous, incoming) {
  return [...new Map([...previous, ...incoming].map(message => [message.id, message])).values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function makeSupportApi(sb) {
  const listeners = new Set();
  let channel, timer, debounce, authSubscription;
  const notify = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => listeners.forEach(listener => listener()), 60);
  };
  const rpc = async (name, params) => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user?.id) throw new Error('not_authenticated');
    const { data, error } = await sb.rpc(name, params);
    if (error) throw error;
    const current = await sb.auth.getSession();
    if (current.data.session?.user?.id !== session.user.id) throw new Error('session_changed');
    return data;
  };
  return {
    refresh: notify,
    async userId() { return (await sb.auth.getSession()).data.session?.user?.id || null; },
    inbox: merchantId => rpc('support_inbox', { p_merchant: merchantId || null }),
    messages: (conversation, before) => rpc('support_messages_page', { p_conversation: conversation, p_before: before?.created_at || null, p_before_id: before?.id || null }),
    async start(merchantId, subject, body, requestId) {
      const result = await rpc('support_start_conversation', { p_merchant: merchantId, p_subject: subject, p_body: body, p_request_id: requestId });
      notify(); return result;
    },
    async send(conversation, body, requestId) {
      const result = await rpc('support_send_message', { p_conversation: conversation, p_body: body, p_request_id: requestId });
      notify(); return result;
    },
    async read(conversation, message) { await rpc('support_mark_read', { p_conversation: conversation, p_message: message }); notify(); },
    watch(listener) {
      listeners.add(listener);
      if (!channel) {
        channel = sb.channel('dpa-support-' + crypto.randomUUID());
        for (const table of ['support_conversations', 'support_messages', 'support_reads']) {
          channel.on('postgres_changes', { event: '*', schema: 'public', table }, notify);
        }
        channel.subscribe(status => { if (status === 'SUBSCRIBED') notify(); });
        timer = setInterval(() => { if (document.visibilityState !== 'hidden') notify(); }, 30000);
        document.addEventListener('visibilitychange', notify);
        authSubscription = sb.auth.onAuthStateChange(() => queueMicrotask(notify)).data.subscription;
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && channel) {
          sb.removeChannel(channel); channel = null;
          clearInterval(timer); clearTimeout(debounce);
          document.removeEventListener('visibilitychange', notify);
          authSubscription?.unsubscribe(); authSubscription = null;
        }
      };
    },
  };
}
