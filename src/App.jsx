import React, { useEffect, useMemo, useState } from 'react'
import { BRAND, OWNER_PIN, DEFAULT_TTL_DAYS, LOW_STOCK_THRESHOLD } from './config'
import notes from './seedNotes.json'
import { auth, signin, SignOut, getUserRole, setUserRole, listenInventory, addInventory, updateInventory, uploadPhoto } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'

const DEALERSHIPS = ['SAS HERO','Indian Hero','Combined']
const ROLES = ['viewer','editor']

const pad = (n) => String(n).padStart(2,'0')
function nowStr() { const d=new Date(); return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` }
const inDays = (n) => Date.now() + n*24*60*60*1000

export default function App() {
  const [dealership, setDealership] = useState('SAS HERO')
  const [dateFilter, setDateFilter] = useState('09-11-2025')
  const [query, setQuery] = useState('')
  const [vehicleType, setVehicleType] = useState('All')
  const [items, setItems] = useState([])
  const [itemsIH, setItemsIH] = useState([])
  const [installEvent, setInstallEvent] = useState(null)
  const [isStandalone, setIsStandalone] = useState(false)

  const [user, setUser] = useState(null)
  const [roleDoc, setRoleDoc] = useState(null)
  const [expired, setExpired] = useState(true)

  const [showOwner, setShowOwner] = useState(false)
  const [ownerPin, setOwnerPin] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState('viewer')
  const [newUserDays, setNewUserDays] = useState(DEFAULT_TTL_DAYS)

  const [lowStockThreshold, setLowStockThreshold] = useState(LOW_STOCK_THRESHOLD)
  const [hindi, setHindi] = useState(BRAND.hindiLabels)

  useEffect(() => {
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone)
    const handler = (e) => { e.preventDefault(); setInstallEvent(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u?.email) {
        const rd = await getUserRole(u.email)
        setRoleDoc(rd)
        setExpired(!(rd && rd.expiresAt && Date.now() < rd.expiresAt))
      } else { setRoleDoc(null); setExpired(true) }
    })
    return () => unsub()
  }, [])

  // Subscriptions
  useEffect(() => {
    if (!dateFilter) return
    let unsub1, unsub2
    if (dealership === 'Combined' || dealership === 'SAS HERO') {
      unsub1 = listenInventory({ dealership: 'SAS HERO', date: dateFilter }, setItems)
    }
    if (dealership === 'Combined' || dealership === 'Indian Hero') {
      unsub2 = listenInventory({ dealership: 'Indian Hero', date: dateFilter }, setItemsIH)
    }
    if (dealership === 'SAS HERO') setItemsIH([])
    if (dealership === 'Indian Hero') setItems([])
    return () => { unsub1 && unsub1(); unsub2 && unsub2() }
  }, [dealership, dateFilter])

  const allItems = dealership==='Combined' ? [...items, ...itemsIH] : (dealership==='SAS HERO' ? items : itemsIH)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allItems.filter(it =>
      (vehicleType === 'All' || it.vehicleType === vehicleType) &&
      (!q || [it.model, it.variant, it.color, it.status].filter(Boolean).join(' ').toLowerCase().includes(q))
    )
  }, [allItems, vehicleType, query])
  const total = filtered.reduce((s, it) => s + (Number(it.quantity)||0), 0)
  const lowStock = filtered.filter(it => (Number(it.quantity)||0) < lowStockThreshold)

  const canEdit = !!(user && roleDoc && !expired && roleDoc.role === 'editor')

  const addItem = async (e) => {
    e.preventDefault()
    if (!canEdit) return alert('Editing disabled')
    const f = new FormData(e.currentTarget)
    const qty = Number(f.get('quantity') || 0)
    const photos = []
    if (f.get('photo') && f.get('photo').size > 0) {
      const file = f.get('photo')
      const path = `photos/${auth.currentUser.uid}/${Date.now()}-${file.name}`
      const url = await uploadPhoto(file, path)
      photos.push(url)
    }
    const item = {
      dealership: f.get('dealership') || (dealership==='Combined'?'SAS HERO':dealership),
      date: f.get('date') || dateFilter,
      model: f.get('model') || 'Untitled',
      variant: f.get('variant') || '',
      color: f.get('color') || '',
      quantity: qty,
      vehicleType: f.get('type') || 'Bike',
      status: f.get('status') || 'Available',
      buyerName: f.get('buyer') || '',
      dueDate: f.get('due') || '',
      photos,
      createdByEmail: user?.email || '',
      updatedByEmail: user?.email || '',
      createdAtText: nowStr(),
      updatedAtText: nowStr(),
      history: [{ at: nowStr(), byEmail: user?.email || '', action: 'add', delta: qty, newQty: qty }]
    }
    await addInventory(item)
    e.currentTarget.reset()
  }

  const adjust = async (it, delta) => {
    if (!canEdit) return alert('Editing disabled')
    const newQty = Math.max(0, (Number(it.quantity)||0) + delta)
    const entry = { at: nowStr(), byEmail: user?.email || '', action: delta>0?'increment':'decrement', delta, newQty }
    const history = [entry, ...(it.history||[])].slice(0, 50)
    await updateInventory(it.id, { quantity: newQty, updatedByEmail: user?.email || '', updatedAtText: nowStr(), history })
  }

  const editBooking = async (it) => {
    if (!canEdit) return alert('Editing disabled')
    const buyer = prompt('Buyer Name', it.buyerName || '') ?? it.buyerName
    const due = prompt('Due date (DD-MM-YYYY)', it.dueDate || '') ?? it.dueDate
    await updateInventory(it.id, { buyerName: buyer, dueDate: due, updatedByEmail: user?.email || '', updatedAtText: nowStr() })
  }

  const toggleBooked = async (it) => {
    if (!canEdit) return alert('Editing disabled')
    const newStatus = it.status === 'Booked' ? 'Available' : 'Booked'
    const entry = { at: nowStr(), byEmail: user?.email || '', action: newStatus==='Booked'?'booked':'unbooked', delta:0, newQty: Number(it.quantity)||0 }
    const history = [entry, ...(it.history||[])].slice(0, 50)
    await updateInventory(it.id, { status: newStatus, updatedByEmail: user?.email || '', updatedAtText: nowStr(), history })
  }

  const uploadPhotoForItem = async (it, file) => {
    if (!canEdit) return alert('Editing disabled')
    if (!file) return
    const path = `photos/${auth.currentUser.uid}/${it.id}-${Date.now()}-${file.name}`
    const url = await uploadPhoto(file, path)
    const photos = Array.isArray(it.photos) ? [url, ...it.photos] : [url]
    await updateInventory(it.id, { photos })
  }

  const exportCSV = () => {
    const rows = [
      ['Dealership','Date','Model','Variant','Color','VehicleType','Quantity','Status','BuyerName','DueDate','Updated By','Updated At'],
      ...filtered.map(it => [it.dealership,it.date,it.model,it.variant||'',it.color||'',it.vehicleType,it.quantity,it.status||'Available',it.buyerName||'',it.dueDate||'',it.updatedByEmail||'',it.updatedAtText||''])
    ]
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download=`${dealership}-${dateFilter||'all'}-inventory.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const shareWhatsApp = () => {
    const lines = []
    lines.push(`*${BRAND.appTitle}*`)
    lines.push(`*Dealer:* ${dealership}`)
    lines.push(`*Date:* ${dateFilter}`)
    filtered.forEach(it => {
      lines.push(`• ${it.model}${it.variant?' '+it.variant:''}${it.color?' ('+it.color+')':''} — ${it.quantity}${it.status==='Booked'?' [BOOKED]':''}`)
    })
    lines.push(`*Total:* ${total}`)
    const txt = encodeURIComponent(lines.join('\n'))
    const url = `https://wa.me/?text=${txt}`
    window.open(url, '_blank')
  }

  const daysLeft = roleDoc && roleDoc.expiresAt ? Math.max(0, Math.ceil((roleDoc.expiresAt - Date.now())/(24*60*60*1000))) : 0

  const list = filtered
  const grouped = Object.values(list.reduce((acc, it) => {
    const key = [it.model || '', it.variant || '', it.color || ''].join('|')
    acc[key] = acc[key] || { model: it.model, variant: it.variant, color: it.color, qty: 0 }
    acc[key].qty += Number(it.quantity)||0
    return acc
  }, {}))

  return (
    <div style={{fontFamily:'inherit', padding:16, maxWidth:1100, margin:'0 auto'}}>
      <div style={{display:'flex', gap:12, alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', borderBottom:'3px solid #E21E26', paddingBottom:8}}>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <img src={dealership==='SAS HERO'?BRAND.sasLogo:BRAND.ihLogo} alt="logo" width="36" height="36" style={{borderRadius:8}} />
          <div>
            <h1 style={{margin:0, fontSize:26, fontWeight:800, color:BRAND.primary}}>{BRAND.appTitle}</h1>
            <div style={{color:'#6b7280'}}>Dealership: <b>{dealership}</b> • Date: {dateFilter} • Total: <b>{total}</b></div>
          </div>
        </div>
        <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
          <button onClick={shareWhatsApp} style={{padding:'8px 12px', border:`1px solid ${BRAND.primary}`, color: BRAND.primary, borderRadius:12, background:'#fff'}}>WhatsApp</button>
          <button onClick={exportCSV} style={{padding:'8px 12px', border:`1px solid ${BRAND.primary}`, color: BRAND.primary, borderRadius:12, background:'#fff'}}>Export CSV</button>
          {!user ? (
            <button onClick={()=>signin()} style={{padding:'8px 12px', border:`1px solid ${BRAND.primary}`, color: BRAND.primary, borderRadius:12, background:'#fff'}}>Sign in</button>
          ) : (
            <button onClick={()=>SignOut(auth)} style={{padding:'8px 12px', border:`1px solid ${BRAND.primary}`, color: BRAND.primary, borderRadius:12, background:'#fff'}}>Sign out</button>
          )}
          <button onClick={()=>setShowOwner(true)} style={{padding:'8px 12px', border:`1px solid ${BRAND.primary}`, color: BRAND.primary, borderRadius:12, background:'#fff'}}>Owner Approve</button>
        </div>
      </div>

      <div style={{display:'flex', gap:8, marginTop:12, flexWrap:'wrap'}}>
        {DEALERSHIPS.map(d => (
          <button key={d} onClick={() => setDealership(d)} style={{padding:'8px 12px', borderRadius:999, border:'2px solid', borderColor: dealership===d ? BRAND.primary : '#e5e7eb', background: dealership===d ? BRAND.accent : '#fff', color: BRAND.dark}}>{d}</button>
        ))}
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12, marginTop:12}}>
        <input placeholder="Search model / variant / colour" value={query} onChange={e=>setQuery(e.target.value)} style={{padding:10, border:'1px solid #e5e7eb', borderRadius:12}} />
        <input placeholder="DD-MM-YYYY" value={dateFilter} onChange={e=>setDateFilter(e.target.value)} style={{padding:10, border:'1px solid #e5e7eb', borderRadius:12}} />
        <select value={vehicleType} onChange={e=>setVehicleType(e.target.value)} style={{padding:10, border:'1px solid #e5e7eb', borderRadius:12}}>
          <option>All</option>
          <option>Bike</option>
          <option>Scooter</option>
        </select>
        <label style={{display:'flex', alignItems:'center', gap:8, border:'1px solid #e5e7eb', borderRadius:12, padding:'0 8px'}}>
          Low stock &lt;
          <input type="number" min="1" value={lowStockThreshold} onChange={e=>setLowStockThreshold(Number(e.target.value)||1)} style={{width:60, padding:8, border:'none', outline:'none'}} />
        </label>
      </div>

      {dealership==='Combined' && (
        <div style={{marginTop:12, border:'1px solid #e5e7eb', borderRadius:12, padding:12}}>
          <b>Combined View (both dealerships)</b>
          <div style={{marginTop:6}}>
            {grouped.length ? grouped.map((g,i)=>(
              <div key={i} style={{display:'flex', justifyContent:'space-between', borderBottom:'1px dashed #eee', padding:'6px 0'}}>
                <div>{g.model}{g.variant?' · '+g.variant:''}{g.color?' · '+g.color:''}</div>
                <div><b>{g.qty}</b></div>
              </div>
            )) : 'No items'}
          </div>
        </div>
      )}

      {dealership!=='Combined' && (dealership==='Indian Hero' && notes && notes.length > 0) && (
        <div style={{marginTop:12, border:'1px solid #fde68a', background:'#fffbeb', color:'#92400e', padding:12, borderRadius:12}}>
          <b>Notes:</b>
          <ul style={{margin:'6px 0 0 18px'}}>
            {notes.map((n,i)=>(<li key={i}>{n}</li>))}
          </ul>
        </div>
      )}

      {lowStock.length > 0 && (
        <div style={{marginTop:12, border:`1px solid ${BRAND.primary}`, background:BRAND.accent, color:'#7f1d1d', padding:12, borderRadius:12}}>
          <b>Low-stock alerts:</b>
          <ul style={{margin:'6px 0 0 18px'}}>
            {lowStock.map((it,i)=>(<li key={i}>{it.model}{it.variant?' '+it.variant:''}{it.color?' ('+it.color+')':''} — {it.quantity}</li>))}
          </ul>
        </div>
      )}

      <details style={{marginTop:12}}>
        <summary style={{cursor:'pointer'}}>Add Stock</summary>
        <form onSubmit={addItem} style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:8, marginTop:8}}>
          <select name="dealership" defaultValue={dealership==='Combined'?'SAS HERO':dealership} style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}}>
            <option>SAS HERO</option>
            <option>Indian Hero</option>
          </select>
          <input name="date" placeholder="DD-MM-YYYY" defaultValue={dateFilter} style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}} />
          <input name="model" placeholder="Model" style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}} />
          <input name="variant" placeholder="Variant" style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}} />
          <input name="color" placeholder="Colour" style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}} />
          <select name="type" style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}}>
            <option>Bike</option>
            <option>Scooter</option>
          </select>
          <select name="status" style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}}>
            <option>Available</option>
            <option>Booked</option>
          </select>
          <input name="buyer" placeholder="Buyer name" style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}} />
          <input name="due" placeholder="Due date (DD-MM-YYYY')" style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}} />
          <input name="quantity" type="number" min="0" defaultValue={1} style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}} />
          <input name="photo" type="file" accept="image/*" style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10}} />
          <button type="submit" disabled={!canEdit} title={canEdit?'':'Editing disabled'} style={{padding:'10px 12px', border:`1px solid ${BRAND.primary}`, color: BRAND.primary, borderRadius:10, background:'#fff', opacity:canEdit?1:0.6}}>Save</button>
        </form>
      </details>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:12, marginTop:12}}>
        {filtered.length ? filtered.map(it => (
          <div key={it.id} style={{border:`2px solid ${(Number(it.quantity)||0)<lowStockThreshold?'#fecaca':'#e5e7eb'}`, borderRadius:16, padding:12}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div style={{fontWeight:800, color:'#2B2B2B'}}>{it.model} {it.variant?('· '+it.variant):''}</div>
              {it.status==='Booked' && <span style={{fontSize:12, background:'#fce7f3', border:'1px solid #f9a8d4', padding:'2px 8px', borderRadius:999}}>BOOKED</span>}
            </div>
            <div style={{aspectRatio:'16 / 9', background:'#F5F5F5', borderRadius:12, display:'grid', placeItems:'center', color:'#6b7280', marginTop:6}}>
              {it.photos && it.photos.length ? (<img src={it.photos[0]} alt="photo" style={{maxWidth:'100%', maxHeight:'100%', objectFit:'cover', borderRadius:12}} />) : (`${it.model} ${it.color ? '· '+it.color : ''}`)}
            </div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8}}>
              <div>
                <div style={{fontSize:12, color:'#6b7280'}}>{[it.color, it.vehicleType].filter(Boolean).join(' · ') || '—'}</div>
                <div style={{fontSize:11, color:'#9ca3af'}}>Last: {it.updatedByEmail || '—'} • {it.updatedAtText || '—'}</div>
                {it.status==='Booked' && (it.buyerName || it.dueDate) && <div style={{fontSize:12, color:'#7c3aed'}}>By: {it.buyerName||'—'} {it.dueDate?('• Due: '+it.dueDate):''}</div>}
              </div>
              <div style={{fontSize:12, padding:'4px 8px', border:`1px solid #E21E26`, color:'#E21E26', borderRadius:999}}>Qty: {it.quantity}</div>
            </div>
            <div style={{display:'flex', gap:8, marginTop:8, flexWrap:'wrap', alignItems:'center'}}>
              <button onClick={()=>editBooking(it)} disabled={!canEdit} style={{padding:'6px 10px', border:`1px solid #E21E26`, color:'#E21E26', borderRadius:8, background:'#fff'}}>Edit Booking</button>
              <button onClick={()=>toggleBooked(it)} disabled={!canEdit} style={{padding:'6px 10px', border:`1px solid #E21E26`, color:'#E21E26', borderRadius:8, background:'#fff'}}>{it.status==='Booked'?'Unbook':'Mark Booked'}</button>
              <button onClick={()=>adjust(it,-1)} disabled={!canEdit || (Number(it.quantity)||0)<=0} style={{padding:'6px 10px', border:`1px solid #E21E26`, color:'#E21E26', borderRadius:8, background:'#fff'}}>−</button>
              <button onClick={()=>adjust(it,1)} disabled={!canEdit} style={{padding:'6px 10px', border:`1px solid #E21E26`, color:'#E21E26', borderRadius:8, background:'#fff'}}>+</button>
              <label style={{border:`1px dashed #E21E26`, color:'#E21E26', padding:'6px 10px', borderRadius:8, background:'#fff', cursor:'pointer'}}>
                Upload Photo
                <input type="file" accept="image/*" onChange={(e)=>{ if(e.target.files[0]) uploadPhotoForItem(it, e.target.files[0]); e.target.value=''; }} style={{display:'none'}} />
              </label>
            </div>
            {it.history && it.history.length > 0 && (
              <details style={{marginTop:6}}>
                <summary style={{cursor:'pointer', fontSize:12, color:'#6b7280'}}>History ({it.history.length})</summary>
                <ul style={{margin:'6px 0 0 18px', fontSize:12, color:'#6b7280'}}>
                  {it.history.slice(0,5).map((h,idx)=>(<li key={idx}>{h.at} — {h.byEmail} — {h.action} {h.delta>0?('+'+h.delta):h.delta}, now {h.newQty}</li>))}
                </ul>
              </details>
            )}
          </div>
        )) : (
          <div style={{color:'#6b7280'}}>No items found.</div>
        )}
      </div>

      {showOwner && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center'}} onClick={()=>setShowOwner(false)}>
          <div style={{background:'#fff', padding:16, borderRadius:12, minWidth:340}} onClick={e=>e.stopPropagation()}>
            <h3 style={{marginTop:0}}>Owner Approval</h3>
            <div style={{display:'grid', gap:8}}>
              <label>Owner PIN
                <input type="password" value={ownerPin} onChange={e=>setOwnerPin(e.target.value)} style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10, width:'100%'}} />
              </label>
              <label>User Email (Google login)
                <input value={newUserEmail} onChange={e=>setNewUserEmail(e.target.value)} placeholder="user@example.com" style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10, width:'100%'}} />
              </label>
              <label>Role
                <select value={newUserRole} onChange={e=>setNewUserRole(e.target.value)} style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10, width:'100%'}}>
                  {ROLES.map(r => <option key={r}>{r}</option>)}
                </select>
              </label>
              <label>Duration (days)
                <input type="number" min="1" value={newUserDays} onChange={e=>setNewUserDays(e.target.value)} style={{padding:10, border:'1px solid #e5e7eb', borderRadius:10, width:'100%'}} />
              </label>
              <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:8}}>
                <button onClick={()=>setShowOwner(false)} style={{padding:'8px 12px', border:'1px solid #e5e7eb', borderRadius:10, background:'#fff'}}>Cancel</button>
                <button onClick={async ()=>{
                  if (ownerPin !== OWNER_PIN) { alert('Wrong Owner PIN'); return }
                  if (!newUserEmail.trim()) { alert('Enter user email'); return }
                  const ttlDays = Math.max(1, Number(newUserDays)||DEFAULT_TTL_DAYS)
                  await setUserRole({ email: newUserEmail.trim().toLowerCase(), role: newUserRole, expiresAt: Date.now() + ttlDays*24*60*60*1000 })
                  alert('Approved! User will get permissions after sign-in.')
                  setShowOwner(false); setOwnerPin(''); setNewUserEmail(''); setNewUserRole('viewer'); setNewUserDays(DEFAULT_TTL_DAYS)
                }} style={{padding:'8px 12px', border:'1px solid #e5e7eb', borderRadius:10, background:'#f3f4f6'}}>Approve</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{textAlign:'center', color:'#9ca3af', fontSize:12, marginTop:20}}>{BRAND.appTitle} • {new Date().toLocaleDateString('en-GB')}</div>
    </div>
  )
}
