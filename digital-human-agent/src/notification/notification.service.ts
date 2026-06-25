import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { normalizePage, normalizePageSize } from '@/common/utils';
import {
  Notification,
  NotificationType,
} from '@/notification/entities/notification.entity';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  async create(input: {
    ownerId?: string | null;
    type: NotificationType;
    title: string;
    message?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<Notification> {
    return this.notificationRepo.save(
      this.notificationRepo.create({
        ownerId: input.ownerId ?? null,
        type: input.type,
        title: input.title,
        message: input.message ?? null,
        payload: input.payload ?? {},
      }),
    );
  }

  async list(query: {
    ownerId?: string | null;
    page?: number;
    pageSize?: number;
    unreadOnly?: boolean;
  }) {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const where: Record<string, unknown> = {};
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.unreadOnly) where.readAt = IsNull();

    const [items, total] = await this.notificationRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const unreadCount = await this.notificationRepo.count({
      where: {
        ...(query.ownerId ? { ownerId: query.ownerId } : {}),
        readAt: IsNull(),
      },
    });

    return { items, total, page, pageSize, unreadCount };
  }

  async markRead(id: string, ownerId?: string | null): Promise<Notification | null> {
    const where = ownerId ? { id, ownerId } : { id };
    const notification = await this.notificationRepo.findOne({ where });
    if (!notification) return null;
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationRepo.save(notification);
    }
    return notification;
  }

  async markAllRead(ownerId?: string | null): Promise<{ updated: number }> {
    const result = await this.notificationRepo.update(
      {
        ...(ownerId ? { ownerId } : {}),
        readAt: IsNull(),
      },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }
}
