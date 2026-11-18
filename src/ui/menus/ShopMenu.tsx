import { ITEMS, SHOP_STOCK, type ItemId } from '../../config/items';
import { CURRENCY } from '../../config/text';
import { useGame } from '../../state/gameStore';
import { useUi } from '../../state/uiStore';
import { CapsuleIcon, Modal } from '../components/common';

export function ShopMenu() {
  const money = useGame((s) => s.player.money);
  const bag = useGame((s) => s.bag);

  const buy = (id: ItemId, n: number) => {
    const g = useGame.getState();
    const cost = ITEMS[id].price * n;
    if (!g.spendMoney(cost)) {
      useUi.getState().showToast('Za mało żetonów.');
      return;
    }
    g.addItem(id, n);
    useUi.getState().showToast(`Kupiono: ${ITEMS[id].name} ×${n}`);
  };

  return (
    <Modal title="Kram">
      <div className="card row between">
        <span className="muted">Witaj w Kramie! Co podać?</span>
        <b>
          {CURRENCY} {money}
        </b>
      </div>
      {SHOP_STOCK.map((id) => {
        const def = ITEMS[id];
        return (
          <div key={id} className="card stack" style={{ gap: 8 }}>
            <div className="row between">
              <div className="row" style={{ gap: 10 }}>
                {def.kind === 'capture' ? <CapsuleIcon size={22} plus={id === 'capsule-plus'} /> : <span style={{ width: 22, textAlign: 'center' }}>🌿</span>}
                <div>
                  <b>{def.name}</b> <span className="muted small">(masz: {bag[id] ?? 0})</span>
                  <div className="muted small">{def.description}</div>
                </div>
              </div>
              <b style={{ whiteSpace: 'nowrap' }}>
                {def.price} {CURRENCY}
              </b>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-small" disabled={money < def.price} onClick={() => buy(id, 1)}>
                Kup 1
              </button>
              <button className="btn btn-small btn-primary" disabled={money < def.price * 5} onClick={() => buy(id, 5)}>
                Kup 5
              </button>
            </div>
          </div>
        );
      })}
    </Modal>
  );
}
