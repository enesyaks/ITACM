/* ================================ APPROVALS ================================ */
/* Two queues: requests routed to me and requests I raised. Only meaningful once
 * the workflow is switched on from Organization. Strings follow the app language
 * via T(en, tr); other languages fall back to English. */
Views.approvals = async function (el) {
  if (isStaleView(el)) return;
  const _lng = (typeof window.i18nLang === 'function' ? window.i18nLang() : 'en');
  // 12-language table keyed by the English string. Order: de, fr, es, it, pt, nl,
  // pl, ru, ar, ja. English and Turkish come from the T() call itself.
  const _APT = {
    'Software / license assignment': ['Software-/Lizenzzuweisung', 'Attribution logiciel / licence', 'Asignación de software / licencia', 'Assegnazione software / licenza', 'Atribuição de software / licença', 'Software-/licentietoewijzing', 'Przypisanie oprogramowania / licencji', 'Назначение ПО / лицензии', 'إسناد برنامج / ترخيص', 'ソフトウェア／ライセンス割当'],
    'Asset sale': ['Asset-Verkauf', 'Vente d\'actif', 'Venta de activo', 'Vendita asset', 'Venda de ativo', 'Assetverkoop', 'Sprzedaż zasobu', 'Продажа актива', 'بيع أصل', '資産売却'],
    'Asset scrap': ['Asset-Verschrottung', 'Mise au rebut d\'actif', 'Baja de activo', 'Rottamazione asset', 'Descarte de ativo', 'Asset afvoeren', 'Złomowanie zasobu', 'Списание актива', 'إتلاف أصل', '資産廃棄'],
    'Service request': ['Service-Anfrage', 'Demande de service', 'Solicitud de servicio', 'Richiesta di servizio', 'Solicitação de serviço', 'Serviceverzoek', 'Wniosek serwisowy', 'Сервисный запрос', 'طلب خدمة', 'サービス要求'],
    Pending: ['Ausstehend', 'En attente', 'Pendiente', 'In sospeso', 'Pendente', 'In afwachting', 'Oczekujące', 'Ожидает', 'معلّق', '保留'],
    Approved: ['Genehmigt', 'Approuvé', 'Aprobado', 'Approvato', 'Aprovado', 'Goedgekeurd', 'Zatwierdzono', 'Согласовано', 'تمت الموافقة', '承認済み'],
    Rejected: ['Abgelehnt', 'Rejeté', 'Rechazado', 'Rifiutato', 'Rejeitado', 'Afgewezen', 'Odrzucono', 'Отклонено', 'مرفوض', '却下'],
    Cancelled: ['Abgebrochen', 'Annulé', 'Cancelado', 'Annullato', 'Cancelado', 'Geannuleerd', 'Anulowano', 'Отменено', 'ملغى', 'キャンセル'],
    'Reject request': ['Anfrage ablehnen', 'Rejeter la demande', 'Rechazar solicitud', 'Rifiuta richiesta', 'Rejeitar solicitação', 'Verzoek afwijzen', 'Odrzuć wniosek', 'Отклонить запрос', 'رفض الطلب', 'リクエストを却下'],
    'Reason (optional)': ['Grund (optional)', 'Motif (facultatif)', 'Motivo (opcional)', 'Motivo (facoltativo)', 'Motivo (opcional)', 'Reden (optioneel)', 'Powód (opcjonalnie)', 'Причина (необязательно)', 'السبب (اختياري)', '理由（任意）'],
    Reject: ['Ablehnen', 'Rejeter', 'Rechazar', 'Rifiuta', 'Rejeitar', 'Afwijzen', 'Odrzuć', 'Отклонить', 'رفض', '却下'],
    'Request rejected': ['Anfrage abgelehnt', 'Demande rejetée', 'Solicitud rechazada', 'Richiesta rifiutata', 'Solicitação rejeitada', 'Verzoek afgewezen', 'Wniosek odrzucony', 'Запрос отклонён', 'تم رفض الطلب', 'リクエストを却下しました'],
    'Approve this request? The related action will run once approved.': ['Diese Anfrage genehmigen? Die zugehörige Aktion wird nach Genehmigung ausgeführt.', 'Approuver cette demande ? L\'action associée s\'exécutera après approbation.', '¿Aprobar esta solicitud? La acción relacionada se ejecutará tras la aprobación.', 'Approvare questa richiesta? L\'azione correlata verrà eseguita dopo l\'approvazione.', 'Aprovar esta solicitação? A ação relacionada será executada após a aprovação.', 'Dit verzoek goedkeuren? De bijbehorende actie wordt na goedkeuring uitgevoerd.', 'Zatwierdzić ten wniosek? Powiązane działanie wykona się po zatwierdzeniu.', 'Согласовать этот запрос? Связанное действие выполнится после согласования.', 'الموافقة على هذا الطلب؟ سيُنفّذ الإجراء المرتبط بعد الموافقة.', 'このリクエストを承認しますか？承認後に関連アクションが実行されます。'],
    'Approved — action processed': ['Genehmigt — Aktion verarbeitet', 'Approuvé — action traitée', 'Aprobado — acción procesada', 'Approvato — azione elaborata', 'Aprovado — ação processada', 'Goedgekeurd — actie verwerkt', 'Zatwierdzono — działanie wykonane', 'Согласовано — действие выполнено', 'تمت الموافقة — تم تنفيذ الإجراء', '承認済み — アクションを処理'],
    Approve: ['Genehmigen', 'Approuver', 'Aprobar', 'Approva', 'Aprovar', 'Goedkeuren', 'Zatwierdź', 'Согласовать', 'موافقة', '承認'],
    Approvals: ['Genehmigungen', 'Approbations', 'Aprobaciones', 'Approvazioni', 'Aprovações', 'Goedkeuringen', 'Zatwierdzenia', 'Согласования', 'الموافقات', '承認'],
    'Approve requests you manage; track requests you raised.': ['Genehmigen Sie Anfragen, die Sie verwalten; verfolgen Sie Ihre eigenen Anfragen.', 'Approuvez les demandes que vous gérez ; suivez celles que vous avez créées.', 'Aprueba las solicitudes que gestionas; sigue las que creaste.', 'Approva le richieste che gestisci; monitora quelle che hai aperto.', 'Aprove as solicitações que você gerencia; acompanhe as que você abriu.', 'Keur verzoeken goed die u beheert; volg verzoeken die u hebt ingediend.', 'Zatwierdzaj wnioski, którymi zarządzasz; śledź własne.', 'Согласуйте запросы, которыми управляете; отслеживайте свои.', 'وافق على الطلبات التي تديرها؛ وتابع طلباتك.', '担当する承認を処理し、自分の申請を追跡します。'],
    'The approval workflow is currently off': ['Der Genehmigungs-Workflow ist derzeit deaktiviert', 'Le flux d\'approbation est actuellement désactivé', 'El flujo de aprobación está desactivado', 'Il flusso di approvazione è attualmente disattivato', 'O fluxo de aprovação está desativado', 'De goedkeuringsworkflow staat momenteel uit', 'Przepływ zatwierdzeń jest obecnie wyłączony', 'Процесс согласования сейчас отключён', 'سير عمل الموافقة معطّل حاليًا', '承認ワークフローは現在オフです'],
    'Turn it on from the Organization page and requests will appear here.': ['Aktivieren Sie ihn auf der Organisationsseite, dann erscheinen Anfragen hier.', 'Activez-le depuis la page Organisation et les demandes apparaîtront ici.', 'Actívalo desde la página Organización y las solicitudes aparecerán aquí.', 'Attivalo dalla pagina Organizzazione e le richieste appariranno qui.', 'Ative na página Organização e as solicitações aparecerão aqui.', 'Schakel het in op de pagina Organisatie en verzoeken verschijnen hier.', 'Włącz go na stronie Organizacja, a wnioski pojawią się tutaj.', 'Включите его на странице «Организация», и запросы появятся здесь.', 'فعّله من صفحة المؤسسة وستظهر الطلبات هنا.', '組織ページで有効にすると、ここに申請が表示されます。'],
    'Waiting for my approval': ['Warten auf meine Genehmigung', 'En attente de mon approbation', 'Esperando mi aprobación', 'In attesa della mia approvazione', 'Aguardando minha aprovação', 'Wacht op mijn goedkeuring', 'Oczekują na moje zatwierdzenie', 'Ожидают моего согласования', 'بانتظار موافقتي', '自分の承認待ち'],
    Type: ['Typ', 'Type', 'Tipo', 'Tipo', 'Tipo', 'Type', 'Typ', 'Тип', 'النوع', '種類'],
    Requester: ['Anfragender', 'Demandeur', 'Solicitante', 'Richiedente', 'Solicitante', 'Aanvrager', 'Zgłaszający', 'Заявитель', 'مقدّم الطلب', '依頼者'],
    Date: ['Datum', 'Date', 'Fecha', 'Data', 'Data', 'Datum', 'Data', 'Дата', 'التاريخ', '日付'],
    Action: ['Aktion', 'Action', 'Acción', 'Azione', 'Ação', 'Actie', 'Akcja', 'Действие', 'إجراء', '操作'],
    'No pending approvals.': ['Keine ausstehenden Genehmigungen.', 'Aucune approbation en attente.', 'Sin aprobaciones pendientes.', 'Nessuna approvazione in sospeso.', 'Sem aprovações pendentes.', 'Geen openstaande goedkeuringen.', 'Brak oczekujących zatwierdzeń.', 'Нет ожидающих согласований.', 'لا موافقات معلّقة.', '保留中の承認はありません。'],
    'My requests': ['Meine Anfragen', 'Mes demandes', 'Mis solicitudes', 'Le mie richieste', 'Minhas solicitações', 'Mijn verzoeken', 'Moje wnioski', 'Мои запросы', 'طلباتي', '自分の申請'],
    Approver: ['Genehmiger', 'Approbateur', 'Aprobador', 'Approvatore', 'Aprovador', 'Goedkeurder', 'Zatwierdzający', 'Согласующий', 'الموافِق', '承認者'],
    Status: ['Status', 'Statut', 'Estado', 'Stato', 'Status', 'Status', 'Status', 'Статус', 'الحالة', '状態'],
    'You have not raised any requests yet.': ['Sie haben noch keine Anfragen gestellt.', 'Vous n\'avez encore créé aucune demande.', 'Aún no has creado ninguna solicitud.', 'Non hai ancora aperto richieste.', 'Você ainda não abriu nenhuma solicitação.', 'U hebt nog geen verzoeken ingediend.', 'Nie złożyłeś jeszcze żadnych wniosków.', 'Вы ещё не создавали запросов.', 'لم تقدّم أي طلبات بعد.', 'まだ申請はありません。'],
    'Withdraw this request? The linked ticket will be cancelled.': ['Diese Anfrage zurückziehen? Das verknüpfte Ticket wird abgebrochen.', 'Retirer cette demande ? Le ticket lié sera annulé.', '¿Retirar esta solicitud? El ticket vinculado se cancelará.', 'Ritirare questa richiesta? Il ticket collegato verrà annullato.', 'Retirar esta solicitação? O ticket vinculado será cancelado.', 'Dit verzoek intrekken? Het gekoppelde ticket wordt geannuleerd.', 'Wycofać ten wniosek? Powiązane zgłoszenie zostanie anulowane.', 'Отозвать этот запрос? Связанная заявка будет отменена.', 'سحب هذا الطلب؟ سيتم إلغاء التذكرة المرتبطة.', 'このリクエストを取り下げますか？関連チケットはキャンセルされます。'],
    'Request withdrawn': ['Anfrage zurückgezogen', 'Demande retirée', 'Solicitud retirada', 'Richiesta ritirata', 'Solicitação retirada', 'Verzoek ingetrokken', 'Wniosek wycofany', 'Запрос отозван', 'تم سحب الطلب', 'リクエストを取り下げました'],
    Amount: ['Betrag', 'Montant', 'Importe', 'Importo', 'Valor', 'Bedrag', 'Kwota', 'Сумма', 'المبلغ', '金額'],
    Opened: ['Geöffnet', 'Ouvert', 'Abierto', 'Aperto', 'Aberto', 'Geopend', 'Otwarto', 'Открыто', 'فُتح', '起票'],
    'Waiting on': ['Wartet auf', 'En attente de', 'Esperando a', 'In attesa di', 'Aguardando', 'Wacht op', 'Oczekuje na', 'Ожидает', 'بانتظار', '待機中'],
    'Decided by': ['Entscheidung von', 'Décidé par', 'Decidido por', 'Deciso da', 'Decidido por', 'Besloten door', 'Zdecydował', 'Решение принял', 'قرّره', '決定者'],
    'Decision note': ['Entscheidungsnotiz', 'Note de décision', 'Nota de decisión', 'Nota decisionale', 'Nota da decisão', 'Beslissingsnotitie', 'Notatka decyzji', 'Примечание к решению', 'ملاحظة القرار', '決定メモ'],
    Close: ['Schließen', 'Fermer', 'Cerrar', 'Chiudi', 'Fechar', 'Sluiten', 'Zamknij', 'Закрыть', 'إغلاق', '閉じる'],
    Withdraw: ['Zurückziehen', 'Retirer', 'Retirar', 'Ritira', 'Retirar', 'Intrekken', 'Wycofaj', 'Отозвать', 'سحب', '取り下げ'],
  };
  const _APIDX = { de: 0, fr: 1, es: 2, it: 3, pt: 4, nl: 5, pl: 6, ru: 7, ar: 8, ja: 9 };
  const T = (en, tr) => {
    if (_lng === 'tr') return tr;
    if (_lng === 'en') return en;
    const row = _APT[en]; const i = _APIDX[_lng];
    return (row && i != null && row[i] != null) ? row[i] : en;
  };

  const TYPE_LABEL = {
    license_assign: T('Software / license assignment', 'Yazılım / lisans zimmeti'),
    asset_sale: T('Asset sale', 'Cihaz satışı'),
    asset_scrap: T('Asset scrap', 'Cihaz hurdaya ayırma'),
    ticket_request: T('Service request', 'Servis talebi'),
  };
  const typeLabel = (ty) => TYPE_LABEL[ty] || ty;
  // Compact "step 2 / 3" position for a multi-step chain.
  const chainPos = (r) => {
    const n = Array.isArray(r.levels) ? r.levels.length : 0;
    return n > 1 ? `<span class="pill pill-slate">${(r.currentLevel || 0) + 1} / ${n}</span>` : '';
  };
  const statusPill = (s) => ({
    pending: `<span class="pill pill-amber"><span class="ms ms-sm">schedule</span> ${esc(T('Pending', 'Bekliyor'))}</span>`,
    approved: `<span class="pill pill-emerald"><span class="ms ms-sm">check</span> ${esc(T('Approved', 'Onaylandı'))}</span>`,
    rejected: `<span class="pill pill-rose"><span class="ms ms-sm">close</span> ${esc(T('Rejected', 'Reddedildi'))}</span>`,
    cancelled: `<span class="pill pill-slate">${esc(T('Cancelled', 'İptal'))}</span>`,
  }[s] || badge(s));
  const when = (d) => (typeof fmtDateTime === 'function' ? fmtDateTime(d) : new Date(d).toLocaleString());

  async function decide(id, decision) {
    if (decision === 'rejected') {
      formModal({
        title: T('Reject request', 'Talebi reddet'),
        fields: [{ name: 'note', label: T('Reason (optional)', 'Neden (opsiyonel)'), type: 'textarea', full: true, maxlength: 1000 }],
        submitLabel: T('Reject', 'Reddet'),
        async onSubmit(d) {
          await api(`/approvals/${encodeURIComponent(id)}/decide`, { method: 'POST', body: { decision: 'rejected', note: d.note } });
          toast(T('Request rejected', 'Talep reddedildi'), 'success');
          await load();
        },
      });
      return;
    }
    confirmModal(T('Approve this request? The related action will run once approved.', 'Bu talep onaylansın mı? Onaylanınca ilgili aksiyon çalıştırılacak.'), async () => {
      try {
        await api(`/approvals/${encodeURIComponent(id)}/decide`, { method: 'POST', body: { decision: 'approved' } });
        toast(T('Approved — action processed', 'Onaylandı — aksiyon işleme alındı'), 'success');
        await load();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function pendingRow(r) {
    return `
      <tr data-open="${esc(r.id)}" style="cursor:pointer">
        <td><div class="cell-title">${esc(r.summary || typeLabel(r.type))}</div>
          <div class="cell-sub"><span class="pill pill-blue">${esc(typeLabel(r.type))}</span>${r.resourceRef ? ` <span class="mono">${esc(r.resourceRef)}</span>` : ''} ${chainPos(r)}</div></td>
        <td>${esc(r.requesterName || '—')}</td>
        <td class="cell-sub">${esc(when(r.createdAt))}</td>
        <td class="actions">
          <button class="btn btn-primary btn-sm" data-approve="${esc(r.id)}"><span class="ms">check</span> ${esc(T('Approve', 'Onayla'))}</button>
          <button class="btn btn-outline btn-sm" data-reject="${esc(r.id)}"><span class="ms">close</span> ${esc(T('Reject', 'Reddet'))}</button>
        </td>
      </tr>`;
  }
  function mineRow(r) {
    return `
      <tr data-open="${esc(r.id)}" style="cursor:pointer">
        <td><div class="cell-title">${esc(r.summary || typeLabel(r.type))}</div>
          <div class="cell-sub"><span class="pill pill-blue">${esc(typeLabel(r.type))}</span>${r.resourceRef ? ` <span class="mono">${esc(r.resourceRef)}</span>` : ''}</div></td>
        <td>${esc(r.approverName || '—')}</td>
        <td>${statusPill(r.status)}</td>
        <td class="cell-sub">${esc(when(r.createdAt))}${r.decidedAt ? ' · ' + esc(when(r.decidedAt)) : ''}</td>
      </tr>`;
  }

  function render(pending, mine, config) {
    el.innerHTML = `
      ${pageHead(T('Approvals', 'Onaylar'), T('Approve requests you manage; track requests you raised.', 'Yöneticisi olduğun talepleri onayla; açtığın talepleri izle.'))}
      ${!config || !config.enabled ? `
        <div class="card card-pad" style="margin-bottom:16px;border-left:3px solid var(--outline-variant)">
          <div class="cell-title"><span class="ms" style="vertical-align:-3px">info</span> ${esc(T('The approval workflow is currently off', 'Onay akışı şu an kapalı'))}</div>
          <div class="cell-sub" style="margin-top:2px">${esc(T('Turn it on from the Organization page and requests will appear here.', 'Organizasyon sayfasından açtığında talepler burada görünür.'))}</div>
        </div>` : ''}

      <div class="card" style="margin-bottom:18px">
        <div class="card-head" style="padding:14px 16px"><h3 class="card-title" style="text-transform:none;font-size:14px">
          <span class="ms" style="vertical-align:-3px">inbox</span> ${esc(T('Waiting for my approval', 'Onayımı bekleyenler'))}
          <span class="badge-count ${pending.length ? '' : 'zero'}">${pending.length}</span></h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>${esc(T('Type', 'Tür'))}</th><th>${esc(T('Requester', 'Talep eden'))}</th><th>${esc(T('Date', 'Tarih'))}</th><th style="text-align:right">${esc(T('Action', 'İşlem'))}</th></tr></thead>
          <tbody>${pending.length ? pending.map(pendingRow).join('') : `<tr><td colspan="4" class="table-empty">${esc(T('No pending approvals.', 'Bekleyen onay yok.'))}</td></tr>`}</tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-head" style="padding:14px 16px"><h3 class="card-title" style="text-transform:none;font-size:14px">
          <span class="ms" style="vertical-align:-3px">outbox</span> ${esc(T('My requests', 'Taleplerim'))}
          <span class="badge-count ${mine.length ? '' : 'zero'}">${mine.length}</span></h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>${esc(T('Type', 'Tür'))}</th><th>${esc(T('Approver', 'Onaycı'))}</th><th>${esc(T('Status', 'Durum'))}</th><th>${esc(T('Date', 'Tarih'))}</th></tr></thead>
          <tbody>${mine.length ? mine.map(mineRow).join('') : `<tr><td colspan="4" class="table-empty">${esc(T('You have not raised any requests yet.', 'Henüz talep açmadın.'))}</td></tr>`}</tbody>
        </table></div>
      </div>`;

    el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); decide(b.dataset.approve, 'approved'); }));
    el.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); decide(b.dataset.reject, 'rejected'); }));
    const byId = new Map([...pending, ...mine].map((r) => [r.id, r]));
    const mineIds = new Set(mine.map((r) => r.id));
    el.querySelectorAll('tr[data-open]').forEach((tr) => tr.addEventListener('click', () => {
      const r = byId.get(tr.dataset.open);
      if (r) openDetail(r, { mine: mineIds.has(r.id) });
    }));
  }

  function withdraw(id) {
    confirmModal(T('Withdraw this request? The linked ticket will be cancelled.', 'Bu talep geri çekilsin mi? Bağlı ticket iptal edilecek.'), async () => {
      try {
        await api('/approvals/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
        toast(T('Request withdrawn', 'Talep geri çekildi'), 'success'); closeModal(); await load();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* Read-only detail for a request: summary, amount, chain position, the current
     approver(s), and the full decision trail — plus quick approve/reject when it's
     still pending and routed to me. */
  function openDetail(r, { mine = false } = {}) {
    const amount = r.payload && r.payload.amount;
    const pendingNow = r.status === 'pending';
    const canApprove = pendingNow && !mine;
    const canWithdraw = pendingNow && mine;
    const waiting = Array.isArray(r.stepState) && r.stepState.length
      ? r.stepState.filter((e) => e.status === 'pending').map((e) => e.name)
      : (r.approverName ? [r.approverName] : []);
    const field = (label, val) => `<div class="form-field"><label>${esc(label)}</label><div style="padding-top:4px">${val}</div></div>`;
    openModal({
      title: r.summary || typeLabel(r.type),
      wide: true,
      body: `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
          <span class="pill pill-blue">${esc(typeLabel(r.type))}</span>
          ${statusPill(r.status)}
          ${r.resourceRef ? `<span class="pill pill-slate"><span class="mono">${esc(r.resourceRef)}</span></span>` : ''}
          ${chainPos(r)}
        </div>
        <div class="form-grid">
          ${field(T('Requester', 'Talep eden'), esc(r.requesterName || '—'))}
          ${amount != null ? field(T('Amount', 'Tutar'), `<strong>₺${esc(Number(amount).toLocaleString('tr-TR'))}</strong>`) : ''}
          ${field(T('Opened', 'Açılış'), `<span class="cell-sub">${esc(when(r.createdAt))}</span>`)}
          ${pendingNow && waiting.length ? field(T('Waiting on', 'Bekleyen onay'), waiting.map((n) => esc(n)).join(', ')) : ''}
          ${!pendingNow && r.decidedBy ? field(T('Decided by', 'Karar veren'), `${esc(r.decidedBy)} <span class="cell-sub">· ${esc(when(r.decidedAt))}</span>`) : ''}
        </div>
        ${r.decisionNote ? `<div class="form-field full"><label>${esc(T('Decision note', 'Karar notu'))}</label><div class="tk-desc">${esc(r.decisionNote)}</div></div>` : ''}
        ${typeof renderApprovalTimeline === 'function' ? renderApprovalTimeline(r.history) : ''}`,
      foot: canApprove
        ? `<button class="btn btn-outline" data-close>${esc(T('Close', 'Kapat'))}</button>
           <button class="btn btn-outline" id="ap-reject" style="color:var(--rose-700)"><span class="ms ms-sm">close</span> ${esc(T('Reject', 'Reddet'))}</button>
           <button class="btn btn-primary" id="ap-approve"><span class="ms ms-sm">check</span> ${esc(T('Approve', 'Onayla'))}</button>`
        : canWithdraw
          ? `<button class="btn btn-outline" data-close>${esc(T('Close', 'Kapat'))}</button>
             <button class="btn btn-outline" id="ap-withdraw" style="color:var(--rose-700)"><span class="ms ms-sm">undo</span> ${esc(T('Withdraw', 'Geri çek'))}</button>`
          : `<button class="btn btn-outline" data-close>${esc(T('Close', 'Kapat'))}</button>`,
      onMount(ov) {
        $('#ap-approve', ov)?.addEventListener('click', () => { closeModal(); decide(r.id, 'approved'); });
        $('#ap-reject', ov)?.addEventListener('click', () => { closeModal(); decide(r.id, 'rejected'); });
        $('#ap-withdraw', ov)?.addEventListener('click', () => withdraw(r.id));
      },
    });
  }

  async function load() {
    const [pending, mine, config] = await Promise.all([
      api('/approvals/pending').catch(() => []),
      api('/approvals/mine').catch(() => []),
      api('/approvals/config').catch(() => null),
    ]);
    if (isStaleView(el)) return;
    render(pending || [], mine || [], config);
  }

  try {
    await load();
  } catch (err) {
    if (isStaleView(el)) return;
    el.innerHTML = `<div class="card card-pad"><div class="form-error">${esc(err.message)}</div></div>`;
  }
};
