/* Vue 3 handles state; D3 parses the CSV and renders both interactive charts. */
const { createApp, ref, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue;
const rub = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const categoryColors = ['#548772','#b3c59d','#e9b181','#a8bac7','#d8c3a2','#bcaeca','#95b8b0','#e0b8b6','#c8cfb9','#c8b17f','#aeb3cf'];
function summarize(data) {
  const orders = new Set();
  let spend = 0, saved = 0, discountSum = 0, units = 0;
  for (const r of data) {
    orders.add(r.order_id); spend += r.amount; saved += r.discount * r.quantity;
    if (r.price > 0) { discountSum += r.discount / r.price * 100 * r.quantity; units += r.quantity; }
  }
  return { orders: orders.size, spend, saved, discountPct: units ? discountSum / units : 0 };
}
createApp({
  setup() {
    const rows = ref([]), loading = ref(true), error = ref('');
    const from = ref(''), to = ref(''), category = ref(''), status = ref('доставлен');
    const metric = ref('spend'), productMetric = ref('quantity'), search = ref(''), selectedMonth = ref(''), page = ref(1);
    const trend = ref(null), categoryChart = ref(null), productChart = ref(null), kpiCharts = ref(null), tooltip = ref(null);
    const metrics = [{key:'orders', label:'Заказы'}, {key:'spend', label:'Траты'}, {key:'discountPct', label:'Скидка'}];
    const minMonth = computed(() => rows.value[0]?.month || '');
    const maxMonth = computed(() => rows.value.at(-1)?.month || '');
    const categories = computed(() => [...new Set(rows.value.map(r=>r.category))].sort((a,b)=>a.localeCompare(b,'ru')));
    const color = name => categoryColors[categories.value.indexOf(name) % categoryColors.length] || categoryColors[0];
    const monthLabel = m => m ? new Date(m+'-01T12:00:00').toLocaleDateString('ru-RU',{month:'long',year:'numeric'}).replace(' г.','') : '';
    const shortMonth = m => new Date(m+'-01T12:00:00').toLocaleDateString('ru-RU',{month:'short'}).replace('.','');
    const num = n => rub.format(n), decimal = n => dec.format(n), money = n => num(n)+' ₽';
    const compactMoney = n => n >= 1e6 ? decimal(n/1e6)+' млн' : n >= 10000 ? decimal(n/1000)+' тыс.' : num(n);
    const metricTitle = computed(() => ({orders:'Количество заказов',spend:'Сумма трат, ₽',discountPct:'Средняя скидка, %'})[metric.value]);
    function monthOffset(month, offset) {
      if (!month) return '';
      const date = new Date(month + '-01T12:00:00'); date.setMonth(date.getMonth() + offset);
      return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    }
    const last12Start = computed(() => monthOffset(maxMonth.value, -11));
    const last24Start = computed(() => monthOffset(maxMonth.value, -23));
    const rangeMode = computed(() => from.value===minMonth.value&&to.value===maxMonth.value?'all':from.value===last24Start.value&&to.value===maxMonth.value?'24':from.value===last12Start.value&&to.value===maxMonth.value?'12':'custom');
    const monthKeys = computed(() => {
      if(!from.value || !to.value || from.value>to.value) return [];
      const keys = []; const d = new Date(from.value+'-01T12:00:00'); const end = new Date(to.value+'-01T12:00:00');
      while(d<=end && keys.length<1200) { keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); d.setMonth(d.getMonth()+1); }
      return keys;
    });
    const contextRows = computed(() => rows.value.filter(r=>r.month>=from.value&&r.month<=to.value&&(!category.value||r.category===category.value)&&(!status.value||r.status===status.value)));
    const filteredRows = computed(() => selectedMonth.value ? contextRows.value.filter(r=>r.month===selectedMonth.value) : contextRows.value);
    const summary = computed(() => summarize(filteredRows.value));
    const currentMonth = computed(() => selectedMonth.value || to.value);
    const currentSummary = computed(() => summarize(contextRows.value.filter(r => r.month === currentMonth.value)));
    const previousSummary = computed(() => summarize(rows.value.filter(r => r.month === monthOffset(currentMonth.value, -1) && (!category.value || r.category === category.value) && (!status.value || r.status === status.value))));
    function changeLabel(key) {
      const current = currentSummary.value[key], previous = previousSummary.value[key];
      if (key === 'discountPct') return (current-previous>=0?'+':'') + decimal(current-previous) + ' п.п. к предыдущему месяцу';
      if (!previous) return current ? 'Нет базы для сравнения с прошлым месяцем' : 'Без изменений к предыдущему месяцу';
      const change = (current / previous - 1) * 100;
      return (change >= 0 ? '+' : '') + decimal(change) + '% к предыдущему месяцу';
    }
    const monthCount = computed(() => selectedMonth.value ? 1 : Math.max(1,monthKeys.value.length));
    const periodLabel = computed(() => selectedMonth.value ? monthLabel(selectedMonth.value) : monthLabel(from.value)+' — '+monthLabel(to.value));
    const monthly = computed(() => {
      const groups = d3.group(contextRows.value,r=>r.month);
      return monthKeys.value.map(month => ({month,...summarize(groups.get(month)||[])}));
    });
    const categoryStats = computed(() => Array.from(d3.group(filteredRows.value,r=>r.category), ([name,rs])=>({name,...summarize(rs),quantity:d3.sum(rs,r=>r.quantity)})).sort((a,b)=>b.spend-a.spend));
    const productStats = computed(() => Array.from(d3.group(filteredRows.value.filter(r=>r.category!=='Услуги Груши'),r=>r.item_name), ([name,rs])=>({name,category:rs[0].category,orders:new Set(rs.map(r=>r.order_id)).size,spend:d3.sum(rs,r=>r.amount),quantity:d3.sum(rs,r=>r.quantity)})));
    const goodsSpend = computed(() => d3.sum(productStats.value,p=>p.spend));
    const favorite = computed(() => [...productStats.value].sort((a,b)=>b.orders-a.orders||b.spend-a.spend)[0] || {});
    const biggest = computed(() => [...productStats.value].sort((a,b)=>b.spend-a.spend)[0] || {});
    const filteredProducts = computed(() => productStats.value.filter(p=>p.name.toLocaleLowerCase('ru').includes(search.value.trim().toLocaleLowerCase('ru'))).sort((a,b)=>b[productMetric.value]-a[productMetric.value]||b.spend-a.spend||a.name.localeCompare(b.name,'ru')));
    const pageCount = computed(() => Math.max(1,Math.ceil(filteredProducts.value.length/8)));
    const visibleProducts = computed(() => filteredProducts.value.slice((page.value-1)*8,page.value*8));
    const maxProductOrders = computed(() => d3.max(productStats.value,p=>p.orders)||1);
    const emojiBg = c => ({'База':'#f5efe3','Фрукты':'#fcf0e4','Овощи':'#edf4e8','Вода':'#eaf2f5','Готовая еда':'#f5eee7','Сладости':'#f8edef','Напитки':'#eef2f7','Снеки':'#faf0df','Товары для дома':'#edf2f0','Аптека':'#f1edf6'})[c]||'#f2f4ed';
    const emoji = (name,c) => {
      const rules = [['молоко','🥛'],['кефир','🥛'],['йогурт','🥛'],['яйц','🥚'],['масло','🧈'],['сырник','🥞'],['сыр','🧀'],['творог','🥛'],['банан','🍌'],['яблок','🍎'],['груша','🍐'],['авокадо','🥑'],['лимон','🍋'],['апельсин','🍊'],['мандарин','🍊'],['виноград','🍇'],['клубник','🍓'],['огур','🥒'],['томат','🍅'],['помидор','🍅'],['картоф','🥔'],['морков','🥕'],['хлеб','🍞'],['шоколад','🍫'],['кофе','☕'],['чай ','🍵'],['чипс','🥔'],['пельмен','🥟'],['куриц','🍗']];
      for(const [s,e] of rules) if(name.toLowerCase().includes(s)) return e;
      return ({'База':'🥣','Фрукты':'🍑','Овощи':'🥬','Вода':'💧','Напитки':'🧃','Готовая еда':'🍱','Сладости':'🍪','Снеки':'🥨','Товары для дома':'🧹','Аптека':'💊'})[c]||'🛒';
    };
    function setRange(mode) { from.value=mode==='all'?minMonth.value:mode==='24'?last24Start.value:last12Start.value; to.value=maxMonth.value; selectedMonth.value=''; }
    function reset() { category.value=''; status.value='доставлен'; search.value=''; selectedMonth.value=''; metric.value='spend'; productMetric.value='quantity'; setRange('24'); }
    let productTipPinned = false;
    function hideTip() { productTipPinned=false; if(tooltip.value){tooltip.value.style.display='none';tooltip.value.classList.remove('pinned');} }
    function showTip(event,title,lines) {
      const el=tooltip.value; if(!el) return;
      productTipPinned=false;el.classList.remove('pinned');
      el.replaceChildren(); const heading=document.createElement('b'); heading.textContent=title; el.append(heading);
      for(const line of lines) {const div=document.createElement('div');div.textContent=line;el.append(div);}
      el.style.display='block'; const box=el.getBoundingClientRect();
      const x=event.clientX ?? event.target.getBoundingClientRect().left, y=event.clientY ?? event.target.getBoundingClientRect().top;
      el.style.left=Math.max(8,Math.min(x+15,window.innerWidth-box.width-10))+'px'; el.style.top=Math.max(8,Math.min(y+12,window.innerHeight-box.height-10))+'px';
    }
    function toggleMonth(m) { selectedMonth.value=selectedMonth.value===m?'':m; hideTip(); }
    function renderTrend() {
      if(!trend.value) return; const host=d3.select(trend.value); host.selectAll('*').remove();
      const width=trend.value.clientWidth, height=trend.value.clientHeight; if(!width) return;
      const margin={top:12,right:9,bottom:43,left:44}, innerW=width-margin.left-margin.right, innerH=height-margin.top-margin.bottom;
      const svg=host.append('svg').attr('width',width).attr('height',height).attr('role','img').attr('aria-label',metricTitle.value+' по месяцам');
      const g=svg.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
      const x=d3.scaleBand().domain(monthly.value.map(d=>d.month)).range([0,innerW]).padding(.42);
      const y=d3.scaleLinear().domain([0,d3.max(monthly.value,d=>d[metric.value])||1]).nice().range([innerH,0]);
      g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(v=>metric.value==='spend'?(v>=1000?decimal(v/1000)+'к':num(v)):metric.value==='discountPct'?decimal(v)+'%':num(v))).call(g=>g.select('.domain').remove()).call(g=>g.selectAll('line').attr('stroke','#ecf0ec').attr('stroke-dasharray','3 4')).call(g=>g.selectAll('text').attr('fill','#a9b4aa').attr('font-size',9).attr('dx',-5));
      const format = d => metric.value==='spend'?money(d.spend):metric.value==='discountPct'?decimal(d.discountPct)+'%':num(d.orders)+' заказов';
      g.selectAll('.bar').data(monthly.value).join('rect').attr('class','bar').attr('x',d=>x(d.month)).attr('y',d=>y(d[metric.value])).attr('width',x.bandwidth()).attr('height',d=>innerH-y(d[metric.value])).attr('rx',Math.min(4,x.bandwidth()/3)).attr('fill',d=>selectedMonth.value===d.month?'#edae7b':selectedMonth.value?'#dce8df':'#709f85');
      const step=Math.max(1,Math.ceil(monthly.value.length/(innerW<400?6:12)));
      const ticks=monthly.value.filter((d,i)=>i%step===0).map(d=>d.month);
      g.append('g').attr('transform',`translate(0,${innerH})`).call(d3.axisBottom(x).tickValues(ticks).tickSize(0).tickPadding(13).tickFormat(m=>shortMonth(m))).call(g=>g.select('.domain').remove()).call(g=>g.selectAll('text').attr('fill','#9ba99e').attr('font-size',9));
      g.selectAll('.year').data(ticks).join('text').attr('class','year').attr('x',d=>x(d)+x.bandwidth()/2).attr('y',innerH+34).attr('text-anchor','middle').attr('fill','#bac2bb').attr('font-size',8).text(d=>d.slice(0,4));
      g.selectAll('.hit').data(monthly.value).join('rect').attr('class','hit').attr('x',d=>Math.max(0,x(d.month)-x.step()*.2)).attr('y',0).attr('width',x.step()).attr('height',innerH).attr('fill','transparent').style('cursor','pointer').attr('tabindex',0).attr('role','button').attr('aria-label',d=>monthLabel(d.month)+': '+format(d)+'. Выбрать месяц').attr('aria-pressed',d=>selectedMonth.value===d.month?'true':'false').on('pointermove', (e,d)=>showTip(e,monthLabel(d.month),['Заказы: '+num(d.orders),'Траты: '+money(d.spend),'Средняя скидка: '+decimal(d.discountPct)+'%'])).on('pointerleave',hideTip).on('click',(e,d)=>toggleMonth(d.month)).on('keydown',(e,d)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleMonth(d.month)}});
    }
    function renderCategories() {
      if (!categoryChart.value) return;
      const host = d3.select(categoryChart.value); host.selectAll('*').remove();
      const width = categoryChart.value.clientWidth, height = categoryChart.value.clientHeight;
      if (!width) return;
      const data = categoryStats.value;
      const svg = host.append('svg').attr('width', width).attr('height', height).attr('role', 'img').attr('aria-label', 'Рейтинг категорий по сумме покупок');
      if (!data.length) { svg.append('text').attr('x', width / 2).attr('y', height / 2).attr('text-anchor', 'middle').attr('fill', '#98a499').attr('font-size', 12).text('Нет трат в выбранном периоде'); return; }
      const y = d3.scaleBand().domain(data.map(d => d.name)).range([0, height - 6]).padding(.25);
      const x = d3.scaleLinear().domain([0, d3.max(data, d => d.spend) || 1]).range([0, width]);
      const groups = svg.selectAll('g').data(data).join('g').attr('transform', d => `translate(0,${y(d.name)})`).attr('role', 'button').attr('tabindex', 0).attr('aria-label', d => 'Фильтр: ' + d.name + ', ' + money(d.spend)).style('cursor', 'pointer');
      groups.append('text').attr('x', 0).attr('y', 10).attr('font-size', 10).attr('fill', '#6b7e70').text(d => d.name);
      groups.append('text').attr('x', width).attr('y', 10).attr('text-anchor', 'end').attr('font-size', 10).attr('font-weight', 600).attr('fill', '#4c6753').text(d => money(d.spend) + ' · ' + decimal(summary.value.spend ? d.spend / summary.value.spend * 100 : 0) + '%');
      groups.append('rect').attr('x', 0).attr('y', 17).attr('width', width).attr('height', 5).attr('rx', 2.5).attr('fill', '#f0f4ef');
      groups.append('rect').attr('x', 0).attr('y', 17).attr('width', d => x(d.spend)).attr('height', 5).attr('rx', 2.5).attr('fill', d => color(d.name));
      groups.append('rect').attr('width', width).attr('height', Math.max(y.bandwidth(), 24)).attr('fill', 'transparent');
      const select = d => { category.value = category.value === d.name ? '' : d.name; hideTip(); };
      groups.on('pointermove', (e, d) => showTip(e, d.name, [money(d.spend), decimal(summary.value.spend ? d.spend / summary.value.spend * 100 : 0) + '% от трат'])).on('pointerleave', hideTip).on('click', (e, d) => select(d)).on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(d); } });
    }
    function renderSparklines() {
      if (!kpiCharts.value) return;
      for (const el of kpiCharts.value.querySelectorAll('[data-spark]')) {
        const key = el.dataset.spark, width = el.clientWidth, height = 42;
        const svg = d3.select(el).selectAll('svg').data([null]).join('svg').attr('width',width).attr('height',height).attr('role','img').attr('aria-label',metrics.find(m=>m.key===key).label + ': динамика за выбранный период');
        svg.selectAll('*').remove(); if(!width || !monthly.value.length) continue;
        const x = d3.scalePoint().domain(monthKeys.value).range([4,width-4]);
        const y = d3.scaleLinear().domain([0,d3.max(monthly.value,d=>d[key])||1]).range([height-5,5]);
        const line = d3.line().x(d=>x(d.month)).y(d=>y(d[key]));
        svg.append('path').datum(monthly.value).attr('d',line).attr('stroke','#709f85').attr('stroke-width',1.8).attr('fill','none');
        const current = monthly.value.find(d=>d.month===currentMonth.value);
        if(current) svg.append('circle').attr('cx',x(current.month)).attr('cy',y(current[key])).attr('r',3).attr('fill','#edae7b');
      }
    }
    function productHistory(product) {
      const groups = d3.group(contextRows.value.filter(r=>r.item_name===product.name),r=>r.month);
      return monthKeys.value.map(month=>{
        const rs=groups.get(month); if(!rs) return {month,price:null,original:null};
        const quantity=d3.sum(rs,r=>r.quantity);
        return {month,price:quantity?d3.sum(rs,r=>r.amount)/quantity:null,original:quantity?d3.sum(rs,r=>r.price*r.quantity)/quantity:null};
      });
    }
    function showProductTip(event, product, pin = false) {
      const history=productHistory(product), observed=history.filter(d=>d.price!==null);
      showTip(event,emoji(product.name,product.category)+' '+product.name,[product.category, 'Заказы: '+num(product.orders)+' · Количество: '+num(product.quantity)+' шт.', 'Траты: '+money(product.spend)]);
      const el=tooltip.value;
      const title=document.createElement('div');title.className='price-title';title.textContent='Средняя цена за единицу по месяцам';el.append(title);
      const period=document.createElement('div');period.className='price-period';period.textContent=monthLabel(from.value)+' — '+monthLabel(to.value);el.append(period);
      if(!observed.length) return;
      const width=Math.min(320,window.innerWidth-65),height=115, margin={left:40,right:14,top:12,bottom:25};
      const svg=d3.select(el).append('svg').attr('width',width).attr('height',height).attr('role','img').attr('aria-label','Динамика средней цены товара после скидки');
      const x=d3.scalePoint().domain(monthKeys.value).range([margin.left,width-margin.right]);
      const extent=d3.extent(observed.flatMap(d=>[d.price,d.original]));
      const y=d3.scaleLinear().domain([Math.max(0,extent[0]*.85),extent[1]*1.1||1]).nice().range([height-margin.bottom,margin.top]);
      const g=svg.append('g');
      g.append('g').attr('transform',`translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(3).tickSize(-(width-margin.left-margin.right)).tickFormat(decimal)).call(g=>g.select('.domain').remove()).call(g=>g.selectAll('line').attr('stroke','#ffffff20')).call(g=>g.selectAll('text').attr('fill','#d1e1d6').attr('font-size',9));
      const tickMonths=[monthKeys.value[0],monthKeys.value[Math.floor((monthKeys.value.length-1)/2)],monthKeys.value.at(-1)];
      g.append('g').attr('transform',`translate(0,${height-margin.bottom})`).call(d3.axisBottom(x).tickValues([...new Set(tickMonths)]).tickSize(0).tickFormat(m=>shortMonth(m)+' '+m.slice(2,4))).call(g=>g.select('.domain').remove()).call(g=>g.selectAll('text').attr('fill','#d1e1d6').attr('font-size',8));
      const line=key=>d3.line().defined(d=>d[key]!==null).x(d=>x(d.month)).y(d=>y(d[key]));
      g.append('path').datum(history).attr('d',line('original')).attr('fill','none').attr('stroke','#b5c6bd').attr('stroke-dasharray','3 3').attr('stroke-width',1.3);
      g.append('path').datum(history).attr('d',line('price')).attr('fill','none').attr('stroke','#edb787').attr('stroke-width',2);
      g.selectAll('circle').data(observed).join('circle').attr('cx',d=>x(d.month)).attr('cy',d=>y(d.price)).attr('r',2.5).attr('fill','#edb787');
      const first=observed[0],last=observed.at(-1);
      const detail=document.createElement('div');detail.className='price-note';detail.textContent='После скидки: '+money(first.price)+(observed.length>1?' → '+money(last.price):' · один месяц с покупками');el.append(detail);
      const legend=document.createElement('div');legend.className='price-legend';
      for(const [label,stroke,dashed] of [['Цена после скидки','#edb787',false],['Цена до скидки','#b5c6bd',true]]){
        const item=document.createElement('div');item.className='price-legend-item';
        const sample=d3.select(item).append('svg').attr('width',34).attr('height',14).attr('aria-hidden','true');
        sample.append('line').attr('x1',1).attr('x2',33).attr('y1',7).attr('y2',7).attr('stroke',stroke).attr('stroke-width',dashed?1.5:2).attr('stroke-dasharray',dashed?'3 3':null);
        if(!dashed)sample.append('circle').attr('cx',17).attr('cy',7).attr('r',3).attr('fill',stroke);
        const caption=document.createElement('span');caption.textContent=label;item.append(caption);legend.append(item);
      }
      el.append(legend);
      const note=document.createElement('div');note.className='price-note';note.textContent='Цены в ₽ за единицу товара. Разрывы — месяцы без покупок.';el.append(note);
      if(observed.length>1){const change=document.createElement('div');change.className='price-note';change.textContent=first.price?'Изменение между '+shortMonth(first.month)+' '+first.month.slice(0,4)+' и '+shortMonth(last.month)+' '+last.month.slice(0,4)+': '+(last.price>=first.price?'+':'')+decimal((last.price/first.price-1)*100)+'%':'Первая цена равна нулю; процент изменения не рассчитывается';el.append(change);}
      if(pin){
        productTipPinned=true;el.classList.add('pinned');
        const close=document.createElement('button');close.className='tooltip-close';close.type='button';close.setAttribute('aria-label','Закрыть динамику цены');close.textContent='×';close.addEventListener('click',hideTip);el.prepend(close);
      }
      positionTip(event);
    }
    function positionTip(event) {
      const el=tooltip.value;if(!el)return;const box=el.getBoundingClientRect();
      const target=event.currentTarget||event.target, rect=target?.getBoundingClientRect?.();
      const x=event.clientX||rect?.left||10, y=event.clientY||rect?.top||10;
      el.style.left=Math.max(8,Math.min(x+15,window.innerWidth-box.width-10))+'px';
      el.style.top=Math.max(8,Math.min(y+12,window.innerHeight-box.height-10))+'px';
    }
    function renderProducts() {
      if(!productChart.value)return;
      const host=d3.select(productChart.value);host.selectAll('*').remove();
      const data=visibleProducts.value,width=productChart.value.clientWidth,stacked=width<620,rowH=stacked?100:64,height=Math.max(100,data.length*rowH+42);
      if(!width)return;
      const svg=host.append('svg').attr('width',width).attr('height',height).attr('role','img').attr('aria-label','Потребление товаров: количество в штуках и сумма в рублях');
      if(!data.length){svg.append('text').attr('x',24).attr('y',50).attr('font-size',12).attr('fill','#89948f').text('Нет товаров по выбранным фильтрам');return;}
      const labelW=stacked?width:Math.min(350,width*.36), gap=50, plotW=stacked?(width-36)/2:(width-labelW-gap-36)/2, quantityX=stacked?12:labelW,spendX=stacked?width/2+6:labelW+plotW+gap;
      const q=d3.scaleLinear().domain([0,d3.max(data,d=>d.quantity)||1]).range([0,plotW]);
      const amount=d3.scaleLinear().domain([0,d3.max(data,d=>d.spend)||1]).range([0,plotW]);
      svg.append('text').attr('x',quantityX).attr('y',14).attr('fill','#709f85').attr('font-size',11).text('Количество, шт.');
      svg.append('text').attr('x',spendX).attr('y',14).attr('fill','#be8b60').attr('font-size',11).text('Сумма покупок, ₽');
      const groups=svg.selectAll('.product-row').data(data).join('g').attr('class','product-row').attr('transform',(d,i)=>`translate(0,${i*rowH+32})`).attr('tabindex',0).attr('role','button').attr('aria-label',d=>'Динамика цены: '+d.name).style('cursor','pointer');
      groups.append('rect').attr('width',width).attr('height',rowH-4).attr('rx',7).attr('fill',(d,i)=>i%2?'#fafbf9':'#fff');
      groups.append('text').attr('x',12).attr('y',30).attr('font-size',24).text(d=>emoji(d.name,d.category));
      groups.each(function(d){
        const words=d.name.split(' '), maxChars=Math.floor((labelW-66)/5.8), lines=[''];
        for(const word of words){const idx=lines.length-1;if((lines[idx]+' '+word).trim().length>maxChars&&lines[idx])lines.push(word);else lines[idx]+=(lines[idx]?' ':'')+word;}
        const text=d3.select(this).append('text').attr('x',48).attr('y',lines.length>1?20:28).attr('font-size',10).attr('fill','#4c6753');
        lines.slice(0,2).forEach((line,i)=>text.append('tspan').attr('x',48).attr('dy',i?14:0).text(i===1&&lines.length>2?line.slice(0,maxChars-1)+'…':line));
      });
      for(const [key,scale,start,fill] of [['quantity',q,quantityX,'#87ac94'],['spend',amount,spendX,'#e6b185']]){
        groups.append('rect').attr('x',start).attr('y',stacked?72:29).attr('width',plotW).attr('height',9).attr('rx',4).attr('fill','#eef2ed');
        groups.append('rect').attr('x',start).attr('y',stacked?72:29).attr('width',d=>scale(d[key])).attr('height',9).attr('rx',4).attr('fill',fill);
        groups.append('text').attr('x',start).attr('y',stacked?62:20).attr('font-size',11).attr('font-weight',600).attr('fill','#597563').text(d=>key==='quantity'?num(d.quantity)+' шт.':money(d.spend));
      }
      groups.on('pointerenter',(e,d)=>showProductTip(e,d)).on('pointermove',positionTip).on('pointerleave',()=>{if(!productTipPinned)hideTip();}).on('focus',(e,d)=>showProductTip(e,d)).on('blur',()=>{if(!productTipPinned)hideTip();}).on('click',(e,d)=>showProductTip(e,d,true)).on('keydown',(e,d)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showProductTip(e,d,true)}if(e.key==='Escape')hideTip();});
    }
    async function render() {await nextTick();renderTrend();renderCategories();renderProducts();renderSparklines();}
    function exportReport() {
      const months=selectedMonth.value?monthly.value.filter(d=>d.month===selectedMonth.value):monthly.value;
      const header=['Месяц','Уникальные заказы','Траты, руб.','Средняя скидка, %','Экономия, руб.','Категория','Статус'];
      const data=months.map(d=>[d.month,d.orders,d.spend,d.discountPct.toFixed(2),d.saved,category.value||'Все категории',status.value||'Все статусы']);
      const csv='\uFEFF'+d3.csvFormatRows([header,...data]);const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
      const a=document.createElement('a');a.href=url;a.download='корзина-отчёт-'+from.value+'-'+to.value+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    watch([contextRows,selectedMonth,metric],()=>{page.value=1;hideTip();render();});
    watch([visibleProducts,productMetric],()=>{hideTip();nextTick(renderProducts);});
    watch(pageCount,n=>{page.value=Math.min(page.value,n)});
    let observer;
    onMounted(async()=>{
      try {
        const response=await fetch('data/orders.csv');if(!response.ok)throw new Error('CSV не найден');
        const data=d3.csvParse(await response.text());
        const required=['order_id','order_date','item_name','category','status','price','price_discounted','discount','quantity','amount'];
        if(!required.every(k=>data.columns.includes(k)))throw new Error('Не хватает обязательных колонок');
        rows.value=data.map(r=>({...r,month:r.order_date.slice(0,7),price:+r.price,price_discounted:+r.price_discounted,discount:+r.discount,quantity:+r.quantity,amount:+r.amount})).sort((a,b)=>a.order_date.localeCompare(b.order_date));
        if(rows.value.some(r=>![r.price,r.price_discounted,r.discount,r.quantity,r.amount].every(Number.isFinite)))throw new Error('Некорректные числовые значения');
        setRange('24');loading.value=false;await nextTick();
        observer=new ResizeObserver(()=>render());observer.observe(trend.value);observer.observe(categoryChart.value);observer.observe(productChart.value);render();
      }catch(e){error.value='Не удалось загрузить данные: '+e.message+'. Откройте дашборд через локальный сервер.';loading.value=false;}
    });
    onBeforeUnmount(()=>observer?.disconnect());
    return {rows,loading,error,from,to,category,status,metric,productMetric,search,selectedMonth,page,metrics,minMonth,maxMonth,categories,color,monthLabel,num,decimal,money,compactMoney,metricTitle,rangeMode,monthKeys,summary,currentMonth,currentSummary,previousSummary,changeLabel,monthCount,periodLabel,categoryStats,productStats,goodsSpend,favorite,biggest,filteredProducts,pageCount,visibleProducts,maxProductOrders,emojiBg,emoji,setRange,reset,exportReport,trend,categoryChart,productChart,kpiCharts,tooltip,showProductTip,hideTip};
  }
}).mount('#app');
