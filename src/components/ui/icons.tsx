/**
 * The app's single icon set, backed by Hugeicons.
 *
 * Every screen imports icons from here, never from an icon package directly,
 * so swapping a glyph (or the whole set) is a one-line change in this file.
 * Components accept the usual SVG props plus `size` and `strokeWidth`.
 */
import { HugeiconsIcon, type HugeiconsProps } from "@hugeicons/react"
import {
  Alert02Icon,
  Award01Icon,
  BotIcon,
  CancelCircleIcon,
  ChartDownIcon,
  CheckmarkCircle02Icon,
  ComputerIcon,
  Copy01Icon,
  Delete02Icon,
  FlashIcon,
  FloppyDiskIcon,
  InformationCircleIcon,
  Link01Icon,
  Message01Icon,
  Moon02Icon,
  Notification03Icon,
  PauseIcon,
  PencilEdit01Icon,
  PlayIcon,
  Radio02Icon,
  RefreshIcon,
  Search01Icon,
  Settings01Icon,
  Shield01Icon,
  ShieldEnergyIcon,
  SmartPhone01Icon,
  Sun03Icon,
  Target02Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons"

type IconProps = Omit<HugeiconsProps, "icon" | "ref">
type IconSvg = NonNullable<HugeiconsProps["icon"]>

function make(icon: IconSvg, displayName: string) {
  const Icon = (props: IconProps) => <HugeiconsIcon icon={icon} {...props} />
  Icon.displayName = displayName
  return Icon
}

export const AlertTriangle = make(Alert02Icon, "AlertTriangle")
export const Award = make(Award01Icon, "Award")
export const Bell = make(Notification03Icon, "Bell")
export const Bot = make(BotIcon, "Bot")
export const CheckCircle2 = make(CheckmarkCircle02Icon, "CheckCircle2")
export const Copy = make(Copy01Icon, "Copy")
export const Info = make(InformationCircleIcon, "Info")
export const Link2 = make(Link01Icon, "Link2")
export const MessageSquare = make(Message01Icon, "MessageSquare")
export const MonitorDot = make(ComputerIcon, "MonitorDot")
export const Moon = make(Moon02Icon, "Moon")
export const Pause = make(PauseIcon, "Pause")
export const PencilLine = make(PencilEdit01Icon, "PencilLine")
export const Play = make(PlayIcon, "Play")
export const Radio = make(Radio02Icon, "Radio")
export const RefreshCw = make(RefreshIcon, "RefreshCw")
export const Save = make(FloppyDiskIcon, "Save")
export const Search = make(Search01Icon, "Search")
export const Settings = make(Settings01Icon, "Settings")
export const Shield = make(Shield01Icon, "Shield")
export const ShieldAlert = make(ShieldEnergyIcon, "ShieldAlert")
export const Smartphone = make(SmartPhone01Icon, "Smartphone")
export const Sun = make(Sun03Icon, "Sun")
export const Target = make(Target02Icon, "Target")
export const Trash2 = make(Delete02Icon, "Trash2")
export const TrendingDown = make(ChartDownIcon, "TrendingDown")
export const Wallet = make(Wallet01Icon, "Wallet")
export const XCircle = make(CancelCircleIcon, "XCircle")
export const Zap = make(FlashIcon, "Zap")
