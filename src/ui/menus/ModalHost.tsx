import { useUi } from '../../state/uiStore';
import { AtlasMenu } from './AtlasMenu';
import { BagMenu } from './BagMenu';
import { JournalMenu } from './JournalMenu';
import { OptionsMenu } from './OptionsMenu';
import { PartyMenu } from './PartyMenu';
import { ShopMenu } from './ShopMenu';

export function ModalHost() {
  const modal = useUi((s) => s.modal);
  switch (modal) {
    case 'party':
      return <PartyMenu />;
    case 'bag':
      return <BagMenu />;
    case 'atlas':
      return <AtlasMenu />;
    case 'journal':
      return <JournalMenu />;
    case 'shop':
      return <ShopMenu />;
    case 'options':
      return <OptionsMenu />;
    default:
      return null;
  }
}
