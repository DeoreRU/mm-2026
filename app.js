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
    const metric = ref('spend'), productMetric = ref('orders'), search = ref(''), selectedMonth = ref(''), page = ref(1);
    const trend = ref(null), categoryChart = ref(null), tooltip = ref(null);
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
    const last12Start = computed(() => {
      if(!maxMonth.value) return '';
      const d = new Date(maxMonth.value+'-01T12:00:00'); d.setMonth(d.getMonth()-11);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    });
    const rangeMode = computed(() => from.value===minMonth.value&&to.value===maxMonth.value?'all':from.value===last12Start.value&&to.value===maxMonth.value?'12':'custom');
    const monthKeys = computed(() => {
      if(!from.value || !to.value || from.value>to.value) return [];
      const keys = []; const d = new Date(from.value+'-01T12:00:00'); const end = new Date(to.value+'-01T12:00:00');
      while(d<=end && keys.length<1200) { keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`); d.setMonth(d.getMonth()+1); }
      return keys;
    });
    const contextRows = computed(() => rows.value.filter(r=>r.month>=from.value&&r.month<=to.value&&(!category.value||r.category===category.value)&&(!status.value||r.status===status.value)));
    const filteredRows = computed(() => selectedMonth.value ? contextRows.value.filter(r=>r.month===selectedMonth.value) : contextRows.value);
    const summary = computed(() => summarize(filteredRows.value));
    const monthCount = computed(() => selectedMonth.value ? 1 : Math.max(1,monthKeys.value.length));
    const periodLabel = computed(() => selectedMonth.value ? monthLabel(selectedMonth.value) : monthLabel(from.value)+' — '+monthLabel(to.value));
    const monthly = computed(() => {
      const groups = d3.group(contextRows.value,r=>r.month);
      return monthKeys.value.map(month => ({month,...summarize(groups.get(month)||[])}));
    });
    const categoryStats = computed(() => Array.from(d3.group(filteredRows.value,r=>r.category), ([name,rs])=>({name,spend:d3.sum(rs,r=>r.amount)})).filter(c=>c.spend>0).sort((a,b)=>b.spend-a.spend));
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
    function setRange(mode) { from.value=mode==='all'?minMonth.value:last12Start.value; to.value=maxMonth.value; selectedMonth.value=''; }
    function reset() { category.value=''; status.value='доставлен'; search.value=''; selectedMonth.value=''; metric.value='spend'; productMetric.value='orders'; setRange('12'); }
    function hideTip() { if(tooltip.value) tooltip.value.style.display='none'; }
    function showTip(event,title,lines) {
      const el=tooltip.value; if(!el) return;
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
      groups.append('text').attr('x', width).attr('y', 10).attr('text-anchor', 'end').attr('font-size', 10).attr('font-weight', 600).attr('fill', '#4c6753').text(d => money(d.spend) + ' · ' + decimal(d.spend / summary.value.spend * 100) + '%');
      groups.append('rect').attr('x', 0).attr('y', 17).attr('width', width).attr('height', 5).attr('rx', 2.5).attr('fill', '#f0f4ef');
      groups.append('rect').attr('x', 0).attr('y', 17).attr('width', d => x(d.spend)).attr('height', 5).attr('rx', 2.5).attr('fill', d => color(d.name));
      groups.append('rect').attr('width', width).attr('height', Math.max(y.bandwidth(), 24)).attr('fill', 'transparent');
      const select = d => { category.value = category.value === d.name ? '' : d.name; hideTip(); };
      groups.on('pointermove', (e, d) => showTip(e, d.name, [money(d.spend), decimal(d.spend / summary.value.spend * 100) + '% от трат'])).on('pointerleave', hideTip).on('click', (e, d) => select(d)).on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(d); } });
    }
    async function render() {await nextTick();renderTrend();renderCategories();}
    function exportReport() {
      const months=selectedMonth.value?monthly.value.filter(d=>d.month===selectedMonth.value):monthly.value;
      const header=['Месяц','Уникальные заказы','Траты, руб.','Средняя скидка, %','Экономия, руб.','Категория','Статус'];
      const data=months.map(d=>[d.month,d.orders,d.spend,d.discountPct.toFixed(2),d.saved,category.value||'Все категории',status.value||'Все статусы']);
      const csv='\uFEFF'+d3.csvFormatRows([header,...data]);const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
      const a=document.createElement('a');a.href=url;a.download='корзина-отчёт-'+from.value+'-'+to.value+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    watch([contextRows,selectedMonth,metric],()=>{page.value=1;hideTip();render();});
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
        setRange('12');loading.value=false;await nextTick();
        observer=new ResizeObserver(()=>render());observer.observe(trend.value);observer.observe(categoryChart.value);render();
      }catch(e){error.value='Не удалось загрузить данные: '+e.message+'. Откройте дашборд через локальный сервер.';loading.value=false;}
    });
    onBeforeUnmount(()=>observer?.disconnect());
    return {rows,loading,error,from,to,category,status,metric,productMetric,search,selectedMonth,page,metrics,minMonth,maxMonth,categories,color,monthLabel,num,decimal,money,compactMoney,metricTitle,rangeMode,summary,monthCount,periodLabel,categoryStats,productStats,goodsSpend,favorite,biggest,filteredProducts,pageCount,visibleProducts,maxProductOrders,emojiBg,emoji,setRange,reset,exportReport,trend,categoryChart,tooltip};
  }
}).mount('#app');
