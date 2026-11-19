import { mergeMessages, supportError } from './support-chat-api.js';
import './support-chat.css';

const when = value => value ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';
const totalUnread = rows => rows.reduce((total, row) => total + Number(row.unread || 0), 0);

export function makeSupportComponents(React) {
  const h = React.createElement;
  const icon = name => h('span', { className: 'material-symbols-rounded', 'aria-hidden': true }, name);

  function useInbox(api, merchantId) {
    const [rows, setRows] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const currentUser = React.useRef(null);
    React.useEffect(() => {
      let live = true, generation = 0;
      setRows([]); setLoading(true); setError('');
      const refresh = async () => {
        const request = ++generation;
        try {
          const user = await api.userId();
          if (!live || request !== generation) return;
          if (currentUser.current !== user) { currentUser.current = user; setRows([]); }
          const result = await api.inbox(merchantId);
          if (live && request === generation) { setRows(result || []); setError(''); }
        } catch (reason) {
          if (live && request === generation) {
            if (/not_authenticated|session_changed/.test(reason.message || '')) setRows([]);
            setError(supportError(reason));
          }
        } finally { if (live && request === generation) setLoading(false); }
      };
      refresh();
      const stop = api.watch(refresh);
      return () => { live = false; generation++; stop(); };
    }, [api, merchantId]);
    return { rows, loading, error };
  }

  function Unread({ api, merchantId }) {
    const { rows } = useInbox(api, merchantId);
    const count = totalUnread(rows);
    return count ? h('span', { className: 'dpa-support-badge', 'aria-label': count + ' messages non lus' }, count > 99 ? '99+' : count) : null;
  }

  function Workspace({ api, merchant, admin = false }) {
    const merchantId = admin ? null : merchant?.id;
    const { rows, loading, error: inboxError } = useInbox(api, merchantId);
    const [selected, setSelected] = React.useState(null);
    const [meta, setMeta] = React.useState(null);
    const [creating, setCreating] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [onlyUnread, setOnlyUnread] = React.useState(false);
    const [messages, setMessages] = React.useState([]);
    const [messageLoading, setMessageLoading] = React.useState(false);
    const [hasEarlier, setHasEarlier] = React.useState(false);
    const [earlierLoading, setEarlierLoading] = React.useState(false);
    const [drafts, setDrafts] = React.useState({});
    const [subject, setSubject] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [pending, setPending] = React.useState(null);
    const [userId, setUserId] = React.useState(null);
    const initial = React.useRef(false), sequence = React.useRef(0), scroller = React.useRef(null);
    const nearBottom = React.useRef(true), reload = React.useRef(null), nonces = React.useRef(new Map());
    const active = rows.find(row => row.id === selected) || (meta?.id === selected ? meta : null);
    const draftKey = creating ? 'new' : selected || 'new';
    const body = drafts[draftKey] || '';
    const titleId = React.useId();

    React.useEffect(() => {
      let live = true, previous;
      const identify = async () => {
        const user = await api.userId().catch(() => null);
        if (!live) return;
        if (previous !== undefined && previous !== user) {
          sequence.current++; initial.current = false;
          setSelected(null); setMeta(null); setMessages([]); setDrafts({}); setSubject(''); setCreating(false); setPending(null);
        }
        previous = user; setUserId(user);
      };
      identify(); const stop = api.watch(identify);
      return () => { live = false; stop(); };
    }, [api]);
    React.useEffect(() => {
      if (loading || initial.current) return;
      initial.current = true;
      if (rows[0]) { setSelected(rows[0].id); setMeta(rows[0]); }
      else if (!admin && !inboxError) setCreating(true);
    }, [rows, loading, admin, inboxError]);

    React.useEffect(() => {
      const generation = ++sequence.current;
      setMessages([]); setHasEarlier(false); setError(''); nearBottom.current = true;
      if (!selected || creating) { setMessageLoading(false); return; }
      let live = true;
      setMessageLoading(true);
      const load = async () => {
        try {
          const result = await api.messages(selected);
          if (live && generation === sequence.current) {
            setMessages(previous => mergeMessages(previous, result || []));
            setHasEarlier(previous => previous || result?.length === 80);
            setError('');
          }
        } catch (reason) { if (live && generation === sequence.current) setError(supportError(reason)); }
        finally { if (live && generation === sequence.current) setMessageLoading(false); }
      };
      reload.current = load; load();
      const stop = api.watch(load);
      return () => { live = false; stop(); reload.current = null; };
    }, [api, selected, creating]);

    const last = messages[messages.length - 1];
    const markRead = React.useCallback(() => {
      if (!selected || !last || document.visibilityState === 'hidden' || !nearBottom.current) return;
      api.read(selected, last.id).catch(() => {});
    }, [api, selected, last?.id]);
    React.useLayoutEffect(() => {
      if (nearBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    }, [last?.id, pending]);
    React.useEffect(() => {
      markRead();
      const visible = () => { if (document.visibilityState === 'visible') markRead(); };
      document.addEventListener('visibilitychange', visible);
      return () => document.removeEventListener('visibilitychange', visible);
    }, [markRead]);

    const choose = row => {
      if (busy) return;
      setMeta(row); setSelected(row.id); setCreating(false); setError('');
    };
    const newConversation = () => { if (!busy) { setSelected(null); setMeta(null); setCreating(true); setError(''); } };
    const send = async event => {
      event?.preventDefault();
      if (busy) return;
      const content = body.trim();
      if (!content || content.length > 5000) return setError('Écrivez un message de 1 à 5 000 caractères.');
      if (creating && (subject.trim().length < 3 || subject.trim().length > 140)) return setError('Indiquez un objet de 3 à 140 caractères.');
      if (!creating && !selected) return;
      const fingerprint = JSON.stringify([selected, creating ? subject.trim() : '', content]);
      const previous = nonces.current.get(draftKey);
      const nonce = previous?.fingerprint === fingerprint ? previous.id : crypto.randomUUID();
      nonces.current.set(draftKey, { fingerprint, id: nonce });
      setBusy(true); setError(''); setPending({ body: content, client_id: nonce }); nearBottom.current = true;
      try {
        if (creating) {
          const result = await api.start(merchantId, subject.trim(), content, nonce);
          setMeta(result.conversation); setSelected(result.conversation.id); setCreating(false); setSubject('');
        } else {
          const result = await api.send(selected, content, nonce);
          setMessages(previous => mergeMessages(previous, [result]));
        }
        setDrafts(previous => ({ ...previous, [draftKey]: '' }));
        nonces.current.delete(draftKey);
        api.refresh();
      } catch (reason) { setError(supportError(reason)); }
      finally { setBusy(false); setPending(null); }
    };

    const earlier = async () => {
      if (earlierLoading || !messages[0]) return;
      const conversation = selected, generation = sequence.current;
      const view = scroller.current, height = view?.scrollHeight || 0, top = view?.scrollTop || 0;
      setEarlierLoading(true); nearBottom.current = false;
      try {
        const result = await api.messages(conversation, messages[0]);
        if (generation !== sequence.current) return;
        setMessages(previous => mergeMessages(previous, result || [])); setHasEarlier(result?.length === 80);
        requestAnimationFrame(() => { if (view && generation === sequence.current) view.scrollTop = view.scrollHeight - height + top; });
      } catch (reason) { if (generation === sequence.current) setError(supportError(reason)); }
      finally { setEarlierLoading(false); }
    };

    const filtered = rows.filter(row => (!onlyUnread || Number(row.unread) > 0)
      && [row.subject, row.merchant_name, row.preview].join(' ').toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')));
    const showChat = creating || !!selected;
    return h('section', { className: 'dpa-support', 'data-pane': showChat ? 'chat' : 'list', 'aria-labelledby': titleId },
      h('header', { className: 'dpa-support-heading' },
        h('div', null, h('h2', { id: titleId }, admin ? 'Messagerie' : 'Votre support DPA Cards'),
          h('p', null, admin ? 'Retrouvez les demandes des commerces et répondez directement.' : 'Vos échanges avec l’équipe, réunis au même endroit.')),
        !admin && h('button', { className: 'dpa-support-primary', type: 'button', disabled: busy, onClick: newConversation }, icon('add'), 'Nouvelle conversation')),
      inboxError && h('div', { className: 'dpa-support-error', role: 'alert' }, inboxError,
        h('button', { type: 'button', onClick: () => api.refresh() }, 'Réessayer')),
      h('div', { className: 'dpa-support-layout dpa-glass-surface' },
        h('aside', { className: 'dpa-support-list', 'aria-label': 'Conversations' },
          h('div', { className: 'dpa-support-search' },
            h('label', { htmlFor: titleId + '-search' }, 'Rechercher une conversation'),
            h('input', { id: titleId + '-search', type: 'search', value: query, placeholder: admin ? 'Commerce, objet, message…' : 'Objet, message…', onChange: event => setQuery(event.target.value) }),
            h('label', { className: 'dpa-support-unread-filter' }, h('input', { type: 'checkbox', checked: onlyUnread, onChange: event => setOnlyUnread(event.target.checked) }), 'Non lus')),
          h('div', { className: 'dpa-support-thread-list', 'aria-busy': loading },
            loading && h('p', { className: 'dpa-support-empty', role: 'status' }, 'Chargement des conversations…'),
            !loading && !filtered.length && h('p', { className: 'dpa-support-empty' }, query || onlyUnread ? 'Aucune conversation ne correspond.' : 'Les conversations apparaîtront ici.'),
            filtered.map(row => h('button', { type: 'button', key: row.id, className: 'dpa-support-thread', 'aria-current': selected === row.id && !creating ? 'true' : undefined, disabled: busy, onClick: () => choose(row) },
              h('span', { className: 'dpa-support-thread-top' }, h('strong', null, admin ? row.merchant_name : row.subject), Number(row.unread) > 0 && h('span', { className: 'dpa-support-badge', 'aria-label': row.unread + ' messages non lus' }, Number(row.unread) > 99 ? '99+' : row.unread)),
              admin && h('span', { className: 'dpa-support-thread-subject' }, row.subject),
              h('span', { className: 'dpa-support-preview' }, row.preview || 'Nouvelle conversation'),
              h('time', { dateTime: row.last_at || row.created_at }, when(row.last_at || row.created_at)))))),
        h('div', { className: 'dpa-support-chat' },
          showChat ? h(React.Fragment, null,
            h('header', { className: 'dpa-support-chat-head' },
              h('button', { type: 'button', className: 'dpa-support-back', onClick: () => { if (!busy) { setSelected(null); setCreating(false); } }, 'aria-label': 'Revenir aux conversations' }, icon('arrow_back')),
              h('div', null, h('h3', null, creating ? 'Nouvelle conversation' : active?.subject || 'Conversation'),
                h('p', null, creating ? merchant?.business || 'Votre commerce' : admin ? active?.merchant_name : 'Équipe DPA Cards'))),
            h('div', { className: 'dpa-support-history', ref: scroller, role: 'log', 'aria-label': 'Historique des messages', 'aria-live': 'polite', 'aria-relevant': 'additions',
              onScroll: () => { const view = scroller.current; nearBottom.current = view.scrollHeight - view.scrollTop - view.clientHeight < 70; if (nearBottom.current) markRead(); } },
              hasEarlier && h('button', { type: 'button', className: 'dpa-support-load', disabled: earlierLoading, onClick: earlier }, earlierLoading ? 'Chargement…' : 'Afficher les messages précédents'),
              messageLoading && h('p', { className: 'dpa-support-empty', role: 'status' }, 'Chargement des messages…'),
              !messageLoading && !messages.length && !pending && h('div', { className: 'dpa-support-welcome' }, icon('forum'), h('h4', null, 'Comment pouvons-nous vous aider ?'), h('p', null, 'Décrivez votre demande. Vous retrouverez la réponse dans cette conversation.')),
              messages.map(message => {
                const own = message.author_type === (admin ? 'admin' : 'merchant');
                return h('article', { className: 'dpa-support-message', 'data-own': own, key: message.id },
                  h('span', { className: 'dpa-support-author' }, message.sender_id === userId ? 'Vous' : message.author_type === 'admin' ? 'Équipe DPA Cards' : active?.merchant_name || 'Votre commerce'),
                  h('p', null, message.body), h('time', { dateTime: message.created_at }, when(message.created_at)));
              }),
              pending && !messages.some(message => message.client_id === pending.client_id) && h('article', { className: 'dpa-support-message', 'data-own': true, 'data-pending': true }, h('span', { className: 'dpa-support-author' }, 'Vous'), h('p', null, pending.body), h('span', null, 'Envoi en cours…'))),
            h('form', { className: 'dpa-support-composer', onSubmit: send, 'aria-busy': busy },
              creating && h('label', null, 'Objet de la demande', h('input', { value: subject, onChange: event => setSubject(event.target.value), required: true, minLength: 3, maxLength: 140, disabled: busy, placeholder: 'Ex. Personnalisation de ma carte' })),
              h('label', { className: 'dpa-support-compose-label' }, 'Votre message', h('textarea', { value: body, onChange: event => setDrafts(previous => ({ ...previous, [draftKey]: event.target.value })), required: true, maxLength: 5000, rows: 3, disabled: busy, placeholder: 'Écrivez votre message…',
                onKeyDown: event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } } })),
              error && h('p', { role: 'alert', className: 'dpa-support-error' }, error),
              h('div', { className: 'dpa-support-compose-actions' }, h('small', null, 'Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne'),
                h('button', { type: 'submit', className: 'dpa-support-primary', disabled: busy || !body.trim() }, icon(busy ? 'hourglass_top' : 'send'), busy ? 'Envoi…' : 'Envoyer'))))
            : h('div', { className: 'dpa-support-welcome' }, icon('forum'), h('h3', null, 'Vos conversations'), h('p', null, admin ? 'Sélectionnez un commerce pour lire sa demande et lui répondre.' : 'Sélectionnez une conversation ou envoyez votre première demande.')))));
  }

  function Dialog({ api, merchant, close }) {
    const ref = React.useRef(null), id = React.useId();
    React.useLayoutEffect(() => {
      const dialog = ref.current, previous = document.activeElement, overflow = document.body.style.overflow;
      dialog.showModal(); document.body.style.overflow = 'hidden';
      return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus?.(); };
    }, []);
    return h('dialog', { ref, className: 'dpa-chat-dialog', 'aria-modal': true, 'aria-labelledby': id, onCancel: event => { event.preventDefault(); close(); } },
      h('header', { className: 'dpa-chat-dialog-head' }, h('strong', { id }, 'Support DPA Cards'), h('button', { type: 'button', onClick: close, 'aria-label': 'Fermer le support' }, icon('close'))),
      h(Workspace, { api, merchant }));
  }
  return { Workspace, Dialog, Unread };
}
