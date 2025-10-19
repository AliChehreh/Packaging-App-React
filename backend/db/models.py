from datetime import datetime
from typing import Optional  # ⬅️ added

from sqlalchemy import (
    Integer, String, Date, DateTime, Enum, ForeignKey, UniqueConstraint,
    CheckConstraint, Float, Boolean
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db.session import AppBase as Base
from sqlalchemy.sql import func
import enum

# Roles
class Role(str, enum.Enum):
    packager = "packager"
    supervisor = "supervisor"

class User(Base):
    __tablename__ = "user"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.packager)
    active: Mapped[int] = mapped_column(Integer, default=1)  # 1=true, 0=false

class CartonType(Base):
    __tablename__ = "carton_type"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)  # display/description

    length_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    width_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_weight_lb: Mapped[int] = mapped_column(Integer, default=40)

    style: Mapped[str | None] = mapped_column(String(20), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(64), nullable=True)

    quantity_on_hand: Mapped[int] = mapped_column(Integer, default=0)
    minimum_stock: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    pack_boxes: Mapped[list["PackBox"]] = relationship(
        "PackBox",
        back_populates="carton",
        passive_deletes=True,
    )

class ProductPackagingProfile(Base):
    __tablename__ = "product_packaging_profile"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    depth_in: Mapped[int] = mapped_column(Integer)
    length_mod_in: Mapped[int] = mapped_column(Integer, default=0)
    height_mod_in: Mapped[int] = mapped_column(Integer, default=0)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Order(Base):
    __tablename__ = "order"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_no: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    lead_time_plan: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ship_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="OES")  # OES | manual
    lines: Mapped[list["OrderLine"]] = relationship(back_populates="order", cascade="all, delete-orphan")

class OrderLine(Base):
    __tablename__ = "order_line"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("order.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    product_code: Mapped[str] = mapped_column(String(64), index=True)
    length_in: Mapped[int] = mapped_column(Integer)   # inches (rounded)
    height_in: Mapped[int] = mapped_column(Integer)   # inches (rounded)
    finish: Mapped[str | None] = mapped_column(String(64), nullable=True)
    qty_ordered: Mapped[int] = mapped_column(Integer)
    build_note: Mapped[str | None] = mapped_column(String(255), nullable=True)  # ⬅️ new field
    product_tag: Mapped[str | None] = mapped_column(String(64), nullable=True)   # ⬅️ new field
    

    # relation back to Order
    order: Mapped["Order"] = relationship(back_populates="lines")

class Pack(Base):
    __tablename__ = "pack"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("order.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), default="in_progress")  # in_progress | complete
    started_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    completed_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # ⬅️ changed type

    # easy access: pack.order
    order: Mapped["Order"] = relationship("Order", backref="packs")
    boxes: Mapped[list["PackBox"]] = relationship(
        "PackBox",
        back_populates="pack",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

class PackBox(Base):
    __tablename__ = "pack_box"
    __table_args__ = (
        UniqueConstraint("pack_id", "box_no", name="uq_pack_box_packid_boxno"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pack_id: Mapped[int] = mapped_column(
        ForeignKey("pack.id", ondelete="CASCADE"), index=True, nullable=False
    )
    box_no: Mapped[int] = mapped_column(Integer, nullable=False)   # per-order number
    carton_type_id: Mapped[int | None] = mapped_column(ForeignKey("carton_type.id"), nullable=True)
    custom_l_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    custom_w_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    custom_h_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_lbs: Mapped[int | None] = mapped_column(Integer, nullable=True)  # store rounded up
    max_weight_lb: Mapped[int | None] = mapped_column(Integer, nullable=True)  # per-box limit (override)
    weight_entered: Mapped[float | None] = mapped_column(Float, nullable=True)  # actual weight entered by user

    # relations
    pack: Mapped["Pack"] = relationship(
        "Pack",
        back_populates="boxes",
        foreign_keys=[pack_id],
    )
    carton: Mapped[Optional["CartonType"]] = relationship(  # ⬅️ fixed annotation
        "CartonType",
        back_populates="pack_boxes",
        foreign_keys=[carton_type_id],
    )

class PackBoxItem(Base):
    __tablename__ = "pack_box_item"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Keep cascade ONLY via pack_box to avoid multiple cascade paths in SQL Server
    pack_box_id: Mapped[int] = mapped_column(
        ForeignKey("pack_box.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # NO ondelete cascade here (secondary path) to avoid SQL Server multiple-cascade error
    order_line_id: Mapped[int] = mapped_column(
        ForeignKey("order_line.id"),
        index=True,
        nullable=False,
    )
    qty: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint("qty >= 0", name="ck_pbi_qty_nonneg"),
    )

    # relations
    pack_box: Mapped["PackBox"] = relationship("PackBox", backref="items")
    order_line: Mapped["OrderLine"] = relationship("OrderLine")

class PackLineOverride(Base):
    __tablename__ = "pack_line_override"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Keep cascade via pack
    pack_id: Mapped[int] = mapped_column(
        ForeignKey("pack.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # NO cascade on the line side (secondary path)
    order_line_id: Mapped[int] = mapped_column(
        ForeignKey("order_line.id"),
        index=True,
        nullable=False,
    )

    depth_in: Mapped[int] = mapped_column(Integer)
    length_mod_in: Mapped[int] = mapped_column(Integer, default=0)
    height_mod_in: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        UniqueConstraint("pack_id", "order_line_id", name="uq_pack_line_override"),
    )

class PairGuard(Base):
    __tablename__ = "pair_guard"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Keep cascade via order
    order_id: Mapped[int] = mapped_column(
        ForeignKey("order.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # NO cascade here; also NOT NULL to prevent orphans
    line_a_id: Mapped[int] = mapped_column(ForeignKey("order_line.id"), nullable=False)
    line_b_id: Mapped[int] = mapped_column(ForeignKey("order_line.id"), nullable=False)

    __table_args__ = (
        UniqueConstraint("order_id", "line_a_id", "line_b_id", name="uq_pair_guard"),
        CheckConstraint("line_a_id < line_b_id", name="ck_pair_guard_order"),
    )
